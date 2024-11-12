// Constants
const CONFIG = {
  DEBUG: false,
  CHECK_INTERVAL_MINUTES: 1, // 1 minute
  MAX_RECENT_TABS: 10,
  TAB_CLOSE_TIMEOUT_MS: 6000,
  DEFAULT_SETTINGS: {
    enabled: true,
    timeout: 60*8// 8 hours
  }
};

// State management
class TabStateManager {
  constructor() {
    this.tabTimes = {};
    this.recentlyClosedTabs = [];
  }

  initializeTabs(tabs) {
    const now = Date.now();
    tabs.forEach(tab => {
      this.tabTimes[tab.id] = now;
      Logger.debug('Initialized tab:', { id: tab.id, title: tab.title });
    });
  }

  updateTabTime(tabId) {
    this.tabTimes[tabId] = Date.now();
  }

  async storeClosedTab(tab, isAutoClose) {
    const closedTab = {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favIconUrl,
      closedAt: Date.now(),
      closedBy: isAutoClose ? 'auto' : 'manual'
    };

    this.recentlyClosedTabs.unshift(closedTab);
    if (this.recentlyClosedTabs.length > CONFIG.MAX_RECENT_TABS) {
      this.recentlyClosedTabs.pop();
    }

    delete this.tabTimes[tab.id];
  }

  removeFromRecentlyClosed(tabId) {
    this.recentlyClosedTabs = this.recentlyClosedTabs.filter(tab => tab.id !== tabId);
  }

  clearRecentlyClosed() {
    this.recentlyClosedTabs = [];
  }

  getRecentlyClosed() {
    return this.recentlyClosedTabs;
  }

  getTabLastAccessTime(tabId) {
    return this.tabTimes[tabId] || Date.now();
  }
}

// Logger utility
class Logger {
  static log(message, ...args) {
    if (!CONFIG.DEBUG) return;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, ...args);
  }

  static error(message, error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`, error);
  }

  static debug(...args) {
    if (!CONFIG.DEBUG) return;
    this.log(...args);
  }
}

// Tab management operations
class TabManager {
  constructor(stateManager) {
    this.state = stateManager;
  }

  async closeTab(tab) {
    try {
      const result = await Promise.race([
        new Promise((resolve, reject) => {
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            resolve('SUCCESS');
          });
        }),
        new Promise(resolve => {
          setTimeout(() => resolve('TIMEOUT'), CONFIG.TAB_CLOSE_TIMEOUT_MS);
        })
      ]);

      if (result === 'SUCCESS') {
        await this.state.storeClosedTab(tab, true);
        Logger.debug('Successfully closed tab:', tab.id);
        return true;
      }

      Logger.error('Tab close timeout or error:', tab.id);
      return false;
    } catch (error) {
      Logger.error('Error closing tab:', error);
      return false;
    }
  }

  async checkAndCloseTabs(timeout) {
    const tabs = await chrome.tabs.query({});
    const now = Date.now();

    for (const tab of tabs) {
      const lastAccessed = this.state.getTabLastAccessTime(tab.id);
      const timeSinceAccess = now - lastAccessed;

      Logger.debug('Checking tab:', {
        id: tab.id,
        title: tab.title,
        timeSinceAccess: Math.floor(timeSinceAccess / 1000) + 's'
      });

      if (timeSinceAccess > timeout) {
        await this.closeTab(tab);
      }
    }
  }

  async reopenTab(tabId) {
    const tabInfo = this.state.recentlyClosedTabs.find(tab => tab.id === tabId);
    if (!tabInfo) return false;

    await chrome.tabs.create({ url: tabInfo.url });
    this.state.removeFromRecentlyClosed(tabId);
    return true;
  }
}

// Main extension controller
class TabAutoCloser {
  constructor() {
    this.state = new TabStateManager();
    this.tabManager = new TabManager(this.state);
    this.initialize();
  }

  async initialize() {
    const tabs = await chrome.tabs.query({});
    this.state.initializeTabs(tabs);

    chrome.alarms.create('checkTabs', {
      periodInMinutes: CONFIG.CHECK_INTERVAL_MINUTES
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Tab activity tracking
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      this.state.updateTabTime(tabId);
    });


    // Alarm handler
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name !== 'checkTabs') return;

      const settings = await chrome.storage.sync.get(['enabled', 'timeout']);
      if (!settings.enabled) return;

      const timeoutMs = (settings.timeout ?? CONFIG.DEFAULT_SETTINGS.timeout) * 60 * 1000;
      await this.tabManager.checkAndCloseTabs(timeoutMs);
    });

    // Message handler
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Installation handler
    chrome.runtime.onInstalled.addListener(({ reason }) => {
      if (reason === 'install') {
        chrome.storage.sync.set(CONFIG.DEFAULT_SETTINGS);
      }
    });

    // Browser startup handler
    chrome.runtime.onStartup.addListener(() => this.initialize());
  }

  async handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'getRecentlyClosedTabs':
        sendResponse(this.state.getRecentlyClosed());
        break;

      case 'reopenTab':
        await this.tabManager.reopenTab(request.tabId);
        sendResponse(this.state.getRecentlyClosed());
        break;

      case 'clearRecentlyClosedTabs':
        this.state.clearRecentlyClosed();
        sendResponse(this.state.getRecentlyClosed());
        break;

      case 'removeFromRecentlyClosedTabs':
        this.state.removeFromRecentlyClosed(request.tabId);
        sendResponse(this.state.getRecentlyClosed());
        break;
    }
  }
}

// Initialize the extension
new TabAutoCloser();