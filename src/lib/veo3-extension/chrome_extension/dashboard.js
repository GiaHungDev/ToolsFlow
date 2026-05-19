let rootDirHandle = null;
let jobsQueue = [];
let excelWorkbooks = {}; // Lưu trữ dữ liệu file excel để ghi lại
let isRunning = false;
let isPaused = false;
let currentVeoTabId = null;

const selectFolderBtn = document.getElementById('selectFolderBtn');
const startPipelineBtn = document.getElementById('startPipelineBtn');
const pausePipelineBtn = document.getElementById('pausePipelineBtn');
const currentFolderSpan = document.getElementById('currentFolder');
const totalJobsSpan = document.getElementById('totalJobs');
const completedJobsSpan = document.getElementById('completedJobs');
const logOutput = document.getElementById('logOutput');

const cookieInput = document.getElementById('cookieInput');
const loginCookieBtn = document.getElementById('loginCookieBtn');

let completedCount = 0;

function log(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `log-entry log-${type}`;
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${msg}`;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

selectFolderBtn.addEventListener('click', async () => {
  try {
    rootDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    currentFolderSpan.textContent = rootDirHandle.name;
    log(`Đã chọn thư mục: ${rootDirHandle.name}`, 'success');
    
    await scanFolder(rootDirHandle);
    
    if (jobsQueue.length > 0) {
      startPipelineBtn.disabled = false;
    }
  } catch (err) {
    log(`Lỗi chọn thư mục: ${err.message}`, 'error');
  }
});

loginCookieBtn.addEventListener('click', async () => {
  const jsonStr = cookieInput.value.trim();
  if (!jsonStr) {
    log('Vui lòng dán chuỗi JSON chứa cookies vào ô nhập.', 'warning');
    return;
  }
  
  try {
    const data = JSON.parse(jsonStr);
    const cookiesArray = data.cookies || data; // Hỗ trợ cả 2 format
    if (!Array.isArray(cookiesArray)) {
      throw new Error('Dữ liệu không đúng định dạng mảng cookies.');
    }
    
    log(`Đang nạp ${cookiesArray.length} cookies...`);
    loginCookieBtn.disabled = true;
    
    let successCount = 0;
    const defaultUrl = data.url || 'https://labs.google';

    for (let c of cookiesArray) {
      // Chuẩn bị object cấu hình cookie cho Chrome API
      // Bỏ qua các field chỉ đọc
      const cookieConfig = {
        url: defaultUrl,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly
      };
      
      if (c.expirationDate) cookieConfig.expirationDate = c.expirationDate;
      if (c.sameSite && c.sameSite !== 'unspecified') cookieConfig.sameSite = c.sameSite;
      
      try {
        await chrome.cookies.set(cookieConfig);
        successCount++;
      } catch (err) {
        console.warn(`Lỗi set cookie ${c.name}:`, err);
      }
    }
    
    log(`Đã nạp thành công ${successCount}/${cookiesArray.length} cookies!`, 'success');
    log('Đang mở tab Google Veo để kiểm tra đăng nhập...', 'info');
    
    chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
    
  } catch (err) {
    log(`Lỗi xử lý JSON: ${err.message}`, 'error');
  } finally {
    loginCookieBtn.disabled = false;
  }
});


async function scanFolder(dirHandle) {
  jobsQueue = [];
  log('Đang quét các file Excel...');
  
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls'))) {
      log(`Tìm thấy file: ${entry.name}`);
      await processExcelFile(entry, dirHandle);
    }
  }
  
  totalJobsSpan.textContent = jobsQueue.length;
  log(`Tổng số Job đã nạp: ${jobsQueue.length}`, 'success');
}

async function processExcelFile(fileHandle, rootHandle) {
  const file = await fileHandle.getFile();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  // Tên thư mục con sẽ giống tên file excel (bỏ đuôi)
  const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
  
  // Tạo hoặc lấy thư mục con
  let subDirHandle;
  try {
    subDirHandle = await rootHandle.getDirectoryHandle(baseName, { create: true });
    log(`Sẵn sàng thư mục lưu trữ: ${baseName}/`);
  } catch (e) {
    log(`Không thể tạo thư mục ${baseName}: ${e.message}`, 'error');
    return;
  }
  
  // Lưu vào bộ nhớ để lúc xong Job có thể ghi lại
  excelWorkbooks[baseName] = { fileHandle, workbook, data, sheetName };

  for (const row of data) {
    const job = {
      id: row.JOB_ID || row.ID || `JOB_${Date.now()}`,
      prompt: row.PROMPT || row.prompt || '',
      videoName: row.VIDEO_NAME || row.video_name || `video_${Date.now()}`,
      subDirHandle: subDirHandle,
      excelName: baseName,
      typeVideo: row.TYPE_VIDEO || row.type_video || 'T2V',
      ratio: row.RATIO || row.ratio || '16:9',
      model: row.MODEL || row.model || ''
    };
    if (job.prompt) {
      jobsQueue.push(job);
    }
  }
}

startPipelineBtn.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  isPaused = false;
  startPipelineBtn.disabled = true;
  pausePipelineBtn.style.display = 'inline-block';
  pausePipelineBtn.textContent = 'Tạm dừng';
  log('Bắt đầu tiến trình...', 'success');
  
  await runPipeline();
});

pausePipelineBtn.addEventListener('click', () => {
  if (!isRunning) return;
  isPaused = !isPaused;
  if (isPaused) {
    pausePipelineBtn.textContent = 'Tiếp tục';
    log('Đã tạm dừng tiến trình. Job hiện tại sẽ hoàn thành nốt trước khi dừng.', 'warning');
  } else {
    pausePipelineBtn.textContent = 'Tạm dừng';
    log('Tiếp tục tiến trình...', 'success');
  }
});

async function runPipeline() {
  // Tìm hoặc mở tab Veo
  const tabs = await chrome.tabs.query({ url: "*://labs.google/fx/tools/flow*" });
  if (tabs.length > 0) {
    currentVeoTabId = tabs[0].id;
    await chrome.tabs.update(currentVeoTabId, { active: true });
    log('Đã tìm thấy tab Veo đang mở.');
  } else {
    log('Mở tab Veo mới...');
    const newTab = await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
    currentVeoTabId = newTab.id;
    // Đợi load xong
    await new Promise(r => setTimeout(r, 10000));
  }

  while (jobsQueue.length > 0 && isRunning) {
    if (isPaused) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    const job = jobsQueue.shift();
    log(`Đang xử lý Job: ${job.id} (${job.videoName})`);
    
    try {
      const result = await processJobInVeo(job);
      if (result && result.fifeUri) {
        log(`Job ${job.id} hoàn thành. Đang tiến hành tải video...`, 'success');
        const downloaded = await downloadVideo(result.fifeUri, job);
        if (downloaded) {
            await updateExcelStatus(job, 'Done');
            completedCount++;
            completedJobsSpan.textContent = completedCount;
        } else {
            await updateExcelStatus(job, 'Download Failed');
        }
      } else {
        log(`Job ${job.id} thất bại: ${result?.error || 'Unknown error'}`, 'error');
        await updateExcelStatus(job, 'Failed');
      }
    } catch (e) {
      log(`Lỗi khi chạy Job ${job.id}: ${e.message}`, 'error');
      await updateExcelStatus(job, 'Failed Error');
    }
    
    // Nghỉ một chút giữa các job
    await new Promise(r => setTimeout(r, 3000));
  }
  
  log('Hoàn thành toàn bộ tiến trình!', 'success');
  isRunning = false;
  startPipelineBtn.disabled = false;
  pausePipelineBtn.style.display = 'none';
}

function processJobInVeo(job) {
  return new Promise((resolve, reject) => {
    // Timeout cho mỗi job là 10 phút
    const timeout = setTimeout(() => {
      reject(new Error("Timeout: Job took too long"));
    }, 10 * 60 * 1000);

    // Gửi thông điệp tới content.js
    chrome.tabs.sendMessage(currentVeoTabId, { type: 'START_JOB', job }, (response) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      if (!response || response.status === 'error') {
        clearTimeout(timeout);
        reject(new Error(response?.error || 'Khởi chạy job thất bại'));
        return;
      }
      
      // Nếu thành công trong việc bắt đầu, ta đợi thông báo hoàn thành
      // Content script sẽ gửi message lại cho background hoặc dashboard
      // Ta cần lắng nghe
      const listener = (msg, sender) => {
        if (sender.tab && sender.tab.id === currentVeoTabId && msg.type === 'JOB_COMPLETED' && msg.jobId === job.id) {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg);
        } else if (sender.tab && sender.tab.id === currentVeoTabId && msg.type === 'JOB_FAILED' && msg.jobId === job.id) {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error(msg.error));
        }
      };
      
      chrome.runtime.onMessage.addListener(listener);
    });
  });
}

async function downloadVideo(fifeUri, job) {
  try {
    log(`Bắt đầu tải từ URL: ${fifeUri.substring(0, 50)}...`);
    const response = await fetch(fifeUri);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    
    // Tên file là Video_{id}_video_name.mp4
    const safeId = String(job.id).replace(/[<>:"/\\|?*]+/g, '_');
    const safeName = String(job.videoName).replace(/[<>:"/\\|?*]+/g, '_');
    const fileName = `Video_${safeId}_${safeName}.mp4`;
    
    // Mở file handle trong thư mục con
    const fileHandle = await job.subDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    
    log(`Đã lưu file: ${job.excelName}/${fileName}`, 'success');
    return true;
  } catch (e) {
    log(`Lỗi tải video ${job.id}: ${e.message}`, 'error');
    return false;
  }
}

async function updateExcelStatus(job, statusStr) {
  try {
    const xlInfo = excelWorkbooks[job.excelName];
    if (!xlInfo) return;
    
    // Tìm dòng tương ứng trong JSON data
    const row = xlInfo.data.find(r => (r.JOB_ID || r.ID) == job.id);
    if (row) {
      row.STATUS = statusStr;
    }
    
    // Tạo lại worksheet từ JSON
    const newWorksheet = XLSX.utils.json_to_sheet(xlInfo.data);
    xlInfo.workbook.Sheets[xlInfo.sheetName] = newWorksheet;
    
    // Chuyển sang array buffer
    const excelBuffer = XLSX.write(xlInfo.workbook, { bookType: 'xlsx', type: 'array' });
    
    // Ghi đè vào file thông qua fileHandle
    const writable = await xlInfo.fileHandle.createWritable();
    await writable.write(excelBuffer);
    await writable.close();
    
    log(`Đã cập nhật trạng thái [${statusStr}] cho file Excel: ${job.excelName}.xlsx`, 'info');
  } catch (e) {
    log(`Lỗi cập nhật Excel: ${e.message}`, 'error');
  }
}
