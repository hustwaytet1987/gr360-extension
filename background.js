// ─────────────────────────────────────────────────────────
// GR360 LISTING IMPORTER — BACKGROUND SERVICE WORKER
// ─────────────────────────────────────────────────────────

importScripts("config.js");

const listingTabs = new Set();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "ON_LISTING_PAGE") {
    if (msg.isListing) listingTabs.add(sender.tab.id);
    else listingTabs.delete(sender.tab.id);
    chrome.action.setBadgeText({
      tabId: sender.tab.id,
      text: msg.isListing ? "GO" : ""
    });
    chrome.action.setBadgeBackgroundColor({ color: CONFIG.brandColor });
  }

  if (msg.type === "OPEN_CRM_IMPORT") {
    const data = msg.data;
    chrome.storage.session.set({ gr360_pending_import: data }, () => {
      chrome.tabs.create({ url: `${CONFIG.crmUrl}/import-pending` }, (tab) => {
        const listener = (tabId, info) => {
          if (tabId !== tab.id || info.status !== "complete") return;
          chrome.tabs.onUpdated.removeListener(listener);

          // Check the tab URL — make sure it actually loaded the CRM page
          chrome.tabs.get(tabId, (t) => {
            if (!t || !t.url || !t.url.includes("import-pending")) return;

            // Wait 3 seconds for React to fully mount
            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (importData) => {
                  window.dispatchEvent(
                    new CustomEvent("gr360-import", { detail: importData })
                  );
                },
                args: [data]
              }).catch(err => console.error("GR360 inject error:", err));
            }, 3000);
          });
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  listingTabs.delete(tabId);
});