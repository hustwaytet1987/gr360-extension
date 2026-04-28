// ─────────────────────────────────────────────────────────
// GR360 LISTING IMPORTER — WHITE-LABEL CONFIG
// Change these values for each client deployment.
// Also update host_permissions in manifest.json to match crmUrl.
// ─────────────────────────────────────────────────────────

const CONFIG = {
  // The full base URL of the client's CRM (no trailing slash)
  crmUrl: "https://crm.gardenroute360.co.za",

  // Displayed in the popup header
  companyName: "Garden Route 360",

  // Brand colour for the popup button (hex)
  brandColor: "#D6AF24",

  // Supported listing portal domains
  supportedDomains: [
    "property24.com",
    "privateproperty.co.za",
    "pamgolding.co.za",
    "seeff.com"
  ]
};
