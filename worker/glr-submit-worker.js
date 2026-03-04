/**
 * Cloudflare Worker — GLR Form Submission Proxy
 *
 * Receives form data from the browser, wraps it in a GitHub repository_dispatch
 * event, and forwards it using the GitHub PAT stored as an environment secret.
 *
 * Environment variables (set in Cloudflare Worker Settings > Variables):
 *   GITHUB_TOKEN — Fine-grained PAT with Contents + Actions permissions
 *
 * Allowed origin: https://bootsatwood.github.io
 */

const GITHUB_DISPATCH_URL =
  "https://api.github.com/repos/bootsatwood/glr-onboarding/dispatches";

const ALLOWED_ORIGIN = "https://bootsatwood.github.io";

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Only accept POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(),
      });
    }

    // Parse the form data from the browser
    let formData;
    try {
      formData = await request.json();
    } catch {
      return new Response("Invalid JSON", {
        status: 400,
        headers: corsHeaders(),
      });
    }

    // Forward to GitHub as a repository_dispatch event
    const ghResponse = await fetch(GITHUB_DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "glr-submit-worker",
      },
      body: JSON.stringify({
        event_type: "form-submission",
        client_payload: formData,
      }),
    });

    if (ghResponse.status === 204 || ghResponse.ok) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: corsHeaders("application/json"),
      });
    }

    // Something went wrong — pass through the GitHub error
    const errorText = await ghResponse.text();
    return new Response(`GitHub API error: ${ghResponse.status} — ${errorText}`, {
      status: 502,
      headers: corsHeaders(),
    });
  },
};

function corsHeaders(contentType) {
  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return headers;
}
