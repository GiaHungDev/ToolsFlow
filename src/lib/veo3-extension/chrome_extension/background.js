chrome.action.onClicked.addListener(() => {
  const dashboardUrl = chrome.runtime.getURL('index.html');
  
  chrome.tabs.query({ url: dashboardUrl }, (tabs) => {
    if (tabs.length > 0) {
      // Đã mở, chuyển sang tab đó
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      // Mở tab mới
      chrome.tabs.create({ url: dashboardUrl });
    }
  });
});
