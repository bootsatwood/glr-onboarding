/* ============================================================
   GLR New Facility Onboarding — Application Logic
   ============================================================ */

(function () {
  "use strict";

  const TOTAL_SECTIONS = 7;
  const NPI_API = "https://npiregistry.cms.hhs.gov/api/?version=2.1&number=";

  // GitHub Actions endpoint — form submissions trigger a repository_dispatch event.
  // The DISPATCH_TOKEN is a fine-grained PAT scoped to Actions on this repo only.
  // TODO: Replace with actual values after creating the PAT and enabling the workflow.
  const DISPATCH_URL = "https://api.github.com/repos/bootsatwood/glr-onboarding/dispatches";
  const DISPATCH_TOKEN = "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";

  // Simple passphrase gate — filters casual visitors, not real security
  const PASSPHRASE = "eventus2026";

  let currentSection = 1;

  // --- DOM references ---
  const form = document.getElementById("onboardingForm");
  const sections = form.querySelectorAll(".form-section");
  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnSubmit = document.getElementById("btnSubmit");
  const progressFill = document.getElementById("progressFill");
  const progressLabel = document.getElementById("progressLabel");
  const successScreen = document.getElementById("successScreen");
  const successDetail = document.getElementById("successDetail");

  // --- Initialization ---

  function init() {
    if (!checkPassphrase()) return;
    prefillFromURL();
    showSection(1);
    bindNavigation();
    bindNPIValidation();
  }

  // --- Passphrase gate ---

  function checkPassphrase() {
    // Allow bypass via URL param (for pre-fill links shared with AEs)
    var params = new URLSearchParams(window.location.search);
    if (params.get("key") === PASSPHRASE) return true;

    // Check sessionStorage (already verified this session)
    if (sessionStorage.getItem("glr_auth") === "true") return true;

    // Prompt
    var input = prompt("Enter access code to continue:");
    if (input && input.trim().toLowerCase() === PASSPHRASE) {
      sessionStorage.setItem("glr_auth", "true");
      return true;
    }

    document.querySelector(".form-container").innerHTML =
      '<div style="text-align:center;padding:4rem 2rem;color:#6b7280;">' +
      '<h2>Access Denied</h2><p>Refresh the page to try again.</p></div>';
    return false;
  }

  // --- Pre-fill from URL query parameters ---

  function prefillFromURL() {
    const params = new URLSearchParams(window.location.search);

    params.forEach(function (value, key) {
      // Handle checkboxes (services_provided can have multiple values)
      if (key === "services_provided") {
        var checkboxes = form.querySelectorAll('input[name="services_provided"]');
        var values = value.split(",");
        checkboxes.forEach(function (cb) {
          if (values.indexOf(cb.value) !== -1) {
            cb.checked = true;
          }
        });
        return;
      }

      var el = form.querySelector('[name="' + key + '"]');
      if (!el) return;

      if (el.tagName === "SELECT") {
        // Try exact match first, then case-insensitive
        var found = false;
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].value === value) {
            el.value = value;
            found = true;
            break;
          }
        }
        if (!found) {
          for (var j = 0; j < el.options.length; j++) {
            if (el.options[j].value.toLowerCase() === value.toLowerCase()) {
              el.value = el.options[j].value;
              break;
            }
          }
        }
      } else {
        el.value = value;
      }
    });
  }

  // --- Section navigation ---

  function showSection(n) {
    currentSection = n;
    sections.forEach(function (s) {
      s.classList.remove("active");
    });
    var active = form.querySelector('[data-section="' + n + '"]');
    if (active) active.classList.add("active");

    btnPrev.disabled = n === 1;
    if (n === TOTAL_SECTIONS) {
      btnNext.style.display = "none";
      btnSubmit.style.display = "inline-block";
    } else {
      btnNext.style.display = "inline-block";
      btnSubmit.style.display = "none";
    }

    progressFill.style.width = ((n / TOTAL_SECTIONS) * 100) + "%";
    progressLabel.textContent = "Section " + n + " of " + TOTAL_SECTIONS;

    // Scroll to top of form
    document.querySelector(".form-header").scrollIntoView({ behavior: "smooth" });
  }

  function bindNavigation() {
    btnNext.addEventListener("click", function () {
      if (validateCurrentSection()) {
        showSection(currentSection + 1);
      }
    });

    btnPrev.addEventListener("click", function () {
      if (currentSection > 1) {
        showSection(currentSection - 1);
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (validateCurrentSection()) {
        submitForm();
      }
    });
  }

  // --- Validation ---
  // All fields are optional for now — AEs submit what they have.

  function validateCurrentSection() {
    return true;
  }

  // --- NPI Validation ---

  function bindNPIValidation() {
    var npiInputs = form.querySelectorAll(".npi-input, #facility_npi");

    npiInputs.forEach(function (input) {
      input.addEventListener("blur", function () {
        var npi = input.value.trim();
        if (!npi || npi.length !== 10 || !/^\d{10}$/.test(npi)) {
          clearNPIStatus(input);
          return;
        }
        validateNPI(input, npi);
      });
    });
  }

  function getStatusEl(input) {
    // For facility NPI, the status span is a sibling
    if (input.id === "facility_npi") {
      return document.getElementById("facility_npi_status");
    }
    // For provider NPIs, find by data attribute
    return form.querySelector('[data-npi-for="' + input.id + '"]');
  }

  function clearNPIStatus(input) {
    var status = getStatusEl(input);
    if (status) {
      status.className = "npi-status";
    }
  }

  function validateNPI(input, npi) {
    var status = getStatusEl(input);
    if (!status) return;

    status.className = "npi-status loading";

    fetch(NPI_API + npi)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.result_count && data.result_count > 0) {
          status.className = "npi-status valid";
          status.title = formatNPIResult(data.results[0]);
        } else {
          status.className = "npi-status invalid";
          status.title = "NPI not found in CMS registry";
        }
      })
      .catch(function () {
        status.className = "npi-status";
        status.title = "Unable to verify NPI";
      });
  }

  function formatNPIResult(result) {
    var basic = result.basic || {};
    if (basic.organization_name) {
      return basic.organization_name;
    }
    var parts = [];
    if (basic.first_name) parts.push(basic.first_name);
    if (basic.last_name) parts.push(basic.last_name);
    if (basic.credential) parts.push(basic.credential);
    return parts.join(" ") || "Valid NPI";
  }

  // --- Form submission ---

  function collectFormData() {
    var data = {};
    var elements = form.elements;

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.type === "button" || el.type === "submit") continue;

      if (el.type === "checkbox") {
        if (!data[el.name]) data[el.name] = [];
        if (el.checked) data[el.name].push(el.value);
      } else {
        data[el.name] = el.value;
      }
    }

    return data;
  }

  function submitForm() {
    var data = collectFormData();

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Submitting...";

    if (!DISPATCH_TOKEN) {
      // No token configured — show success with note
      showSuccess(data, "(Demo mode — backend not yet connected)");
      return;
    }

    fetch(DISPATCH_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + DISPATCH_TOKEN,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: "form-submission",
        client_payload: data
      })
    })
      .then(function (res) {
        if (res.status === 204 || res.ok) {
          showSuccess(data, "");
        } else {
          throw new Error("GitHub API returned " + res.status);
        }
      })
      .catch(function (err) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Submit";
        alert("Submission failed: " + err.message + "\n\nPlease try again or contact Roian.");
      });
  }

  function showSuccess(data, note) {
    form.style.display = "none";
    document.querySelector(".form-nav").style.display = "none";
    successScreen.style.display = "block";
    successDetail.textContent = (data.facility_name || "Facility") + " submitted. " + note;
  }

  // --- Start ---
  document.addEventListener("DOMContentLoaded", init);
})();
