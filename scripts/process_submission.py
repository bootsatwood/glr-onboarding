"""
process_submission.py — Process a GLR form submission via GitHub Actions

Triggered by repository_dispatch event. Reads the form payload from the
PAYLOAD environment variable and writes to Monday.com CRM Pipeline board.

Environment variables (set as GitHub Secrets):
    MONDAY_API_TOKEN — Monday.com API token
    PAYLOAD — JSON string of form data (set by the workflow from client_payload)
"""

import json
import os
import sys

import requests

MONDAY_API_URL = "https://api.monday.com/v2"
CRM_BOARD_ID = 9964956612

# Map form field names to Monday.com column IDs and their types.
# Types: "text", "status", "numbers", "date", "location"
FIELD_MAP = {
    # Demographics
    "city":                 {"col": "city__1",                "type": "text"},
    "zip":                  {"col": "text_mkztvfzf",          "type": "text"},
    "parent_company":       {"col": "_corporate_owner__1",    "type": "text"},
    "state":                {"col": "state__1",               "type": "status"},
    "facility_type":        {"col": "type_of_facility1__1",   "type": "status"},
    "care_team":            {"col": "care_team__1",           "type": "status"},
    "services_provided":    {"col": "service_line__1",        "type": "status"},
    "beds":                 {"col": "licensed_bed__1",        "type": "numbers"},
    "census":               {"col": "avg_daily_census__1",    "type": "numbers"},
    "expected_start_date":  {"col": "operational_start_date2__1", "type": "date"},
}


def get_token():
    token = os.environ.get("MONDAY_API_TOKEN")
    if not token:
        print("Error: MONDAY_API_TOKEN not set", file=sys.stderr)
        sys.exit(1)
    return token


def get_payload():
    raw = os.environ.get("PAYLOAD")
    if not raw:
        print("Error: PAYLOAD not set", file=sys.stderr)
        sys.exit(1)
    return json.loads(raw)


def build_column_values(data):
    """Convert form field values to Monday.com column_values JSON."""
    col_values = {}

    for field_name, mapping in FIELD_MAP.items():
        value = data.get(field_name)
        if not value:
            continue

        col_id = mapping["col"]
        col_type = mapping["type"]

        # Handle arrays (services_provided comes as a list from checkboxes)
        if isinstance(value, list):
            value = value[0] if value else ""

        if col_type == "text":
            col_values[col_id] = str(value)
        elif col_type == "status":
            col_values[col_id] = {"label": str(value)}
        elif col_type == "numbers":
            col_values[col_id] = int(value) if value else None
        elif col_type == "date":
            col_values[col_id] = {"date": str(value)}

    return col_values


def build_update_body(data):
    """Build a formatted text update summarizing the full form submission."""
    sections = []

    # Demographics
    demo_fields = [
        ("Facility Name", "facility_name"), ("Facility Type", "facility_type"),
        ("Address", "address"), ("City", "city"), ("State", "state"), ("Zip", "zip"),
        ("Phone", "phone"), ("Fax", "fax"), ("Facility EMR", "facility_emr"),
        ("Parent Company", "parent_company"),
    ]
    demo = format_section("Facility Demographics", demo_fields, data)
    if demo:
        sections.append(demo)

    # Details
    detail_fields = [
        ("Email to Send Schedule", "email_schedule"), ("Fax to Send Schedule", "fax_schedule"),
        ("Email to Send Notes", "email_notes"), ("Fax to Send Notes", "fax_notes"),
        ("Licensed Beds", "beds"), ("Current Census", "census"),
        ("Services Provided", "services_provided"), ("Expected Start Date", "expected_start_date"),
        ("Facility NPI", "facility_npi"),
    ]
    det = format_section("Facility Details", detail_fields, data)
    if det:
        sections.append(det)

    # Vendors
    vendor_fields = [
        ("Lab", "lab"), ("Lab Days", "lab_days"), ("Pharmacy", "pharmacy"),
        ("X-ray/Imaging", "xray"), ("PT/OT/ST", "pt_ot_st"), ("DME", "dme"),
        ("Hospice", "hospice"), ("Home Health", "home_health"),
    ]
    ven = format_section("Vendors", vendor_fields, data)
    if ven:
        sections.append(ven)

    # Contacts
    contact_fields = [
        ("Contact 1", "contact1_name"), ("Contact 1 Title", "contact1_title"),
        ("Contact 1 Email", "contact1_email"),
        ("Contact 2", "contact2_name"), ("Contact 2 Title", "contact2_title"),
        ("Contact 2 Email", "contact2_email"),
        ("Contact 3", "contact3_name"), ("Contact 3 Title", "contact3_title"),
        ("Contact 3 Email", "contact3_email"),
    ]
    con = format_section("Contacts", contact_fields, data)
    if con:
        sections.append(con)

    # Care Team
    care_fields = [
        ("Account Executive", "ae"), ("Care Team", "care_team"),
        ("ADCOE", "adcoe"), ("ADCOE Support", "adcoe_support"),
        ("Medical Director", "medical_director"), ("Medical Director NPI", "medical_director_npi"),
        ("MD/DO Attending", "mddo_attending"), ("MD/DO Attending NPI", "mddo_attending_npi"),
        ("PC Provider", "pc_provider"), ("PC Provider NPI", "pc_provider_npi"),
        ("PC Scheduled Days", "pc_days"),
    ]
    care = format_section("Care Team & Primary Care", care_fields, data)
    if care:
        sections.append(care)

    # Mental Health
    mh_fields = [
        ("Psychiatry Provider", "psych_provider"), ("Psychiatry NPI", "psych_provider_npi"),
        ("Psychiatry Days", "psych_days"),
        ("Psychotherapy Provider", "therapy_provider"), ("Psychotherapy NPI", "therapy_provider_npi"),
        ("Psychotherapy Days", "therapy_days"),
    ]
    mh = format_section("Mental Health Providers", mh_fields, data)
    if mh:
        sections.append(mh)

    # Other Providers
    other_fields = [
        ("Podiatry Provider", "podiatry_provider"), ("Podiatry NPI", "podiatry_provider_npi"),
        ("Podiatry Days", "podiatry_days"),
        ("Wound Care Provider", "wound_provider"), ("Wound Care NPI", "wound_provider_npi"),
        ("Wound Care Days", "wound_days"),
        ("ISNP Provider", "isnp_provider"), ("ISNP NPI", "isnp_provider_npi"),
    ]
    oth = format_section("Other Providers", other_fields, data)
    if oth:
        sections.append(oth)

    return "\n\n".join(sections)


def format_section(title, fields, data):
    """Format a section of fields as HTML for a Monday.com update."""
    lines = []
    for label, key in fields:
        val = data.get(key)
        if isinstance(val, list):
            val = ", ".join(val)
        if val:
            lines.append(f"<b>{label}:</b> {val}")
    if not lines:
        return ""
    return f"<h3>{title}</h3>\n" + "<br>\n".join(lines)


def monday_request(token, query, variables=None):
    """Make a Monday.com API request."""
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
    }
    body = {"query": query}
    if variables:
        body["variables"] = variables

    resp = requests.post(MONDAY_API_URL, json=body, headers=headers)
    resp.raise_for_status()
    result = resp.json()

    if "errors" in result:
        print(f"Monday.com API error: {result['errors']}", file=sys.stderr)
        sys.exit(1)

    return result


def create_item(token, name, column_values):
    """Create a new item on the CRM Pipeline board."""
    query = """
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item(
            board_id: $boardId,
            item_name: $itemName,
            column_values: $columnValues
        ) {
            id
            name
        }
    }
    """
    variables = {
        "boardId": str(CRM_BOARD_ID),
        "itemName": name,
        "columnValues": json.dumps(column_values),
    }
    return monday_request(token, query, variables)


def update_item(token, item_id, column_values):
    """Update an existing item's column values on the CRM Pipeline board."""
    query = """
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
            board_id: $boardId,
            item_id: $itemId,
            column_values: $columnValues
        ) {
            id
            name
        }
    }
    """
    variables = {
        "boardId": str(CRM_BOARD_ID),
        "itemId": str(item_id),
        "columnValues": json.dumps(column_values),
    }
    return monday_request(token, query, variables)


def create_update(token, item_id, body):
    """Add an update (comment) to an item with the full form data."""
    query = """
    mutation ($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
            id
        }
    }
    """
    variables = {"itemId": str(item_id), "body": body}
    return monday_request(token, query, variables)


def main():
    token = get_token()
    data = get_payload()

    facility_name = data.get("facility_name", "Unknown Facility")
    existing_item_id = data.get("item_id", "").strip()

    print(f"Processing submission: {facility_name}")

    # Build column values
    col_values = build_column_values(data)
    print(f"Column values: {json.dumps(col_values, indent=2)}")

    if existing_item_id:
        # UPDATE existing item — item stays in its current group
        print(f"Updating existing item {existing_item_id}")
        result = update_item(token, existing_item_id, col_values)
        item = result["data"]["change_multiple_column_values"]
        item_id = item["id"]
        print(f"Updated item: {item['name']} (ID: {item_id})")
    else:
        # CREATE new item (fallback — shouldn't happen in normal flow)
        print("No item_id provided — creating new item")
        result = create_item(token, facility_name, col_values)
        item = result["data"]["create_item"]
        item_id = item["id"]
        print(f"Created item: {item['name']} (ID: {item_id})")

    # Add a detailed update with ALL form fields (captures data that doesn't
    # map to board columns, like providers, vendors, contacts)
    update_body = build_update_body(data)
    if update_body:
        create_update(token, item_id, update_body)
        print("Added detailed update to item")

    print(f"\nDone. Item {item_id} on board {CRM_BOARD_ID}.")


if __name__ == "__main__":
    main()
