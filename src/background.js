let tabTimes = {};
let recentlyClosedTabs = [];
const MAX_RECENT_TABS = 10;

// Initialize tab tracking
chrome.tabs.query({}, (tabs) => {
  const now = Date.now();
  tabs.forEach(tab => {
    tabTimes[tab.id] = now;
  });
});

// Track tab activity
chrome.tabs.onActivated.addListener((activeInfo) => {
  tabTimes[activeInfo.tabId] = Date.now();
});

// Store tab info before removal and track auto-closed tabs
async function storeClosedTab(tabId, isAutoClose = false) {
  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(tab);
      });
    });

    if (!tab) {
      delete tabTimes[tabId];
      return;
    }

    // Add to recently closed tabs
    const closedTab = {
      id: tabId,
      url: tab.url,
      title: tab.title,
      favicon: tab.favIconUrl,
      closedAt: Date.now(),
      closedBy: isAutoClose ? 'auto' : 'manual'
    };

    recentlyClosedTabs.unshift(closedTab);
    if (recentlyClosedTabs.length > MAX_RECENT_TABS) {
      recentlyClosedTabs.pop();
    }

    delete tabTimes[tabId];
  } catch (error) {
    console.error('Error storing closed tab:', error);
    delete tabTimes[tabId];
  }
}

// Listen for tab removals
chrome.tabs.onRemoved.addListener((tabId) => {
  storeClosedTab(tabId, false);
});

// Check tabs periodically
chrome.alarms.create('checkTabs', { periodInMinutes: 1 });

// Handle periodic check
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkTabs') {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.sync.get(['enabled', 'timeout'], resolve);
      });

      if (!result.enabled) return;

      const timeout = (result.timeout ?? 60) * 60 * 1000; // Convert minutes to milliseconds
      const now = Date.now();

      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({}, resolve);
      });

      for (const tab of tabs) {
        const lastAccessed = tabTimes[tab.id] ?? now;
        if (now - lastAccessed > timeout) {
          try {
            await storeClosedTab(tab.id, true);
            await new Promise((resolve) => {
              chrome.tabs.remove(tab.id, resolve);
            });
          } catch (error) {
            console.error('Error closing tab:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error in alarm handler:', error);
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "getRecentlyClosedTabs":
      sendResponse(recentlyClosedTabs);
      break;

    case "reopenTab":
      const tabInfo = recentlyClosedTabs.find(tab => tab.id === request.tabId);
      if (tabInfo) {
        chrome.tabs.create({ url: tabInfo.url }, () => {
          recentlyClosedTabs = recentlyClosedTabs.filter(tab => tab.id !== request.tabId);
          sendResponse(recentlyClosedTabs);
        });
        return true; // Will respond asynchronously
      }
      sendResponse(recentlyClosedTabs);
      break;

    case "clearRecentlyClosedTabs":
      recentlyClosedTabs = [];
      sendResponse(recentlyClosedTabs);
      break;

    case "removeFromRecentlyClosedTabs":
      recentlyClosedTabs = recentlyClosedTabs.filter(tab => tab.id !== request.tabId);
      sendResponse(recentlyClosedTabs);
      break;
  }
  return true; // Keep message channel open for async responses
});

// Handle extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      enabled: true,
      timeout: 60 // Default to 1 hour
    });
  }
});

// Handle browser startup
chrome.runtime.onStartup.addListener(() => {
  tabTimes = {};
  recentlyClosedTabs = [];

  chrome.tabs.query({}, (tabs) => {
    const now = Date.now();
    tabs.forEach(tab => {
      tabTimes[tab.id] = now;
    });
  });
});