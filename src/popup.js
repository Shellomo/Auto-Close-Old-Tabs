document.addEventListener('DOMContentLoaded', () => {
  const enabledCheckbox = document.getElementById('enabled');
  const timeoutSelect = document.getElementById('timeout');
  const statusDiv = document.getElementById('status');
  const recentTabsList = document.getElementById('recentTabsList');
  const clearAllButton = document.getElementById('clearAll');

  // Load saved settings
  chrome.storage.sync.get(['enabled', 'timeout'], (result) => {
    enabledCheckbox.checked = result.enabled ?? false;
    timeoutSelect.value = result.timeout ?? '60';
    updateStatus();
  });

  // Save settings when changed
  enabledCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: enabledCheckbox.checked });
    updateStatus();
  });

  timeoutSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ timeout: timeoutSelect.value });
    updateStatus();
  });

  clearAllButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "clearRecentlyClosedTabs" }, updateRecentTabs);
  });

  function updateStatus() {
    if (enabledCheckbox.checked) {
      const minutes = parseInt(timeoutSelect.value);
      let timeText = `${minutes} minutes`;
      if (minutes === 1) timeText = '1 minute';
      else if (minutes === 60) timeText = '1 hour';
      else if (minutes > 60) timeText = `${minutes / 60} hours`;

      statusDiv.textContent = `Tabs will close after ${timeText} of inactivity`;
    } else {
      statusDiv.textContent = 'Auto-close is disabled';
    }
  }

  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    }
    const days = Math.floor(seconds / 86400);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }

  // Load and display recently closed tabs
  function updateRecentTabs() {
    chrome.runtime.sendMessage({ action: "getRecentlyClosedTabs" }, (tabs) => {
      recentTabsList.innerHTML = '';

      if (!tabs || tabs.length === 0) {
        recentTabsList.innerHTML = `
          <div class="empty-state">
            No recently closed tabs
          </div>
        `;
        return;
      }

      tabs.forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = 'recent-tab-item';

        const badgeClass = tab.closedBy === 'auto' ? 'badge-auto' : 'badge-manual';
        const badgeText = tab.closedBy === 'auto' ? 'Auto' : 'Manual';

        tabElement.innerHTML = `
          <img class="recent-tab-favicon" src="${tab.favicon || 'icons/icon16.png'}" alt="">
          <div class="recent-tab-content">
            <div class="recent-tab-title" title="${tab.title}">${tab.title}</div>
            <div class="recent-tab-meta">
              <span>${formatTimeAgo(tab.closedAt)}</span>
              <span class="recent-tab-badge ${badgeClass}">${badgeText}</span>
            </div>
          </div>
        `;

        tabElement.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            action: "reopenTab",
            tabId: tab.id
          }, updateRecentTabs);
        });

        recentTabsList.appendChild(tabElement);
      });
    });
  }

  // Update recent tabs when popup opens
  updateRecentTabs();

  // Listen for updates from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "tabsClosed") {
      updateRecentTabs();
    }
  });
});