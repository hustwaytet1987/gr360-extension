// ─────────────────────────────────────────────────────────
// GR360 LISTING IMPORTER — POPUP SCRIPT
// ─────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// Apply white-label config
$("company-name").textContent = CONFIG.companyName;
document.querySelector(".btn-import").style.background = CONFIG.brandColor;
document.querySelector(".btn-import").style.color = "#000";

// Render supported portals list
const supportedList = $("supported-list");
CONFIG.supportedDomains.forEach(domain => {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = domain;
  supportedList.appendChild(tag);
});

function setLoading(on) {
  $("spinner").style.display = on ? "block" : "none";
  $("btn-label").textContent = on ? "Extracting..." : "Import this Listing";
  $("btn-import").disabled = on;
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.style.display = "block";
  $("success").style.display = "none";
}

function showSuccess(msg) {
  const el = $("success");
  el.textContent = msg;
  el.style.display = "block";
  $("error").style.display = "none";
}

// Check if current tab is a listing page
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;

  // Ask content script if this is a listing detail page
  chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_LISTING" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      $("status-badge").className = "status-badge not-listing";
      $("dot").className = "dot grey";
      $("status-text").textContent = "Navigate to a listing page";
      return;
    }

    if (response.error === "not_a_listing") {
      $("status-badge").className = "status-badge not-listing";
      $("dot").className = "dot grey";
      $("status-text").textContent = "Not a listing detail page";
      $("hint").textContent = "Open an individual property listing to import it.";
      return;
    }

    // Valid listing — enable button
    $("status-badge").className = "status-badge on-listing";
    $("dot").className = "dot green";
    $("status-text").textContent = `Ready: ${response.title?.slice(0, 35) || "Listing found"}${response.title?.length > 35 ? "…" : ""}`;
    $("hint").textContent = `${response.images?.length || 0} images found · Click to import`;
    $("btn-import").disabled = false;

    $("btn-import").addEventListener("click", () => {
      setLoading(true);
      $("error").style.display = "none";
      $("success").style.display = "none";

      chrome.runtime.sendMessage({ type: "OPEN_CRM_IMPORT", data: response }, () => {
        if (chrome.runtime.lastError) {
          showError("Failed to open CRM. Please try again.");
          setLoading(false);
          return;
        }
        showSuccess("Opening CRM with listing pre-filled…");
        setLoading(false);
        // Close popup after short delay
        setTimeout(() => window.close(), 1500);
      });
    });
  });
});
