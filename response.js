const responseArea = document.getElementById('responseArea');
const downloadBtn = document.getElementById('downloadBtn');
let currentData = '';

// JSONオブジェクトを階層（<details> / <summary>）要素に再帰的に変換する関数
function createJsonTree(data) {
  if (data === null) {
    const span = document.createElement('span');
    span.className = 'json-null';
    span.textContent = 'null';
    return span;
  }

  const type = typeof data;

  if (type === 'number') {
    const span = document.createElement('span');
    span.className = 'json-number';
    span.textContent = data;
    return span;
  }

  if (type === 'boolean') {
    const span = document.createElement('span');
    span.className = 'json-boolean';
    span.textContent = data;
    return span;
  }

  if (type === 'string') {
    const span = document.createElement('span');
    span.className = 'json-string';
    span.textContent = `"${data}"`;
    return span;
  }

  if (type === 'object') {
    const isArray = Array.isArray(data);
    const keys = Object.keys(data);

    if (keys.length === 0) {
      const span = document.createElement('span');
      span.textContent = isArray ? '[]' : '{}';
      return span;
    }

    const container = document.createElement('div');

    keys.forEach((key) => {
      const row = document.createElement('div');
      row.style.marginLeft = '16px';

      const keySpan = document.createElement('span');
      keySpan.className = 'json-key';
      keySpan.textContent = isArray ? `[${key}]: ` : `"${key}": `;

      const val = data[key];
      if (val !== null && typeof val === 'object') {
        const details = document.createElement('details');
        details.open = true;

        const summary = document.createElement('summary');
        summary.appendChild(keySpan);
        summary.appendChild(document.createTextNode(Array.isArray(val) ? ` Array(${val.length})` : ' Object'));

        details.appendChild(summary);
        details.appendChild(createJsonTree(val));
        row.appendChild(details);
      } else {
        row.appendChild(keySpan);
        row.appendChild(createJsonTree(val));
      }

      container.appendChild(row);
    });

    return container;
  }

  return document.createTextNode(String(data));
}

// データの表示制御処理
function displayData(dataObj) {
  responseArea.innerHTML = '';

  if (!dataObj) return;

  const rawBody = typeof dataObj === 'string' ? dataObj : (dataObj.body || '');
  currentData = rawBody;

  if (typeof dataObj === 'object' && dataObj.status) {
    const statusDiv = document.createElement('div');
    statusDiv.style.marginBottom = '12px';
    statusDiv.style.padding = '8px';
    statusDiv.style.borderRadius = '4px';
    statusDiv.style.fontWeight = 'bold';

    if (typeof dataObj.status === 'number' && dataObj.status >= 200 && dataObj.status < 300) {
      statusDiv.style.backgroundColor = '#e6ffed';
      statusDiv.style.color = '#22863a';
    } else {
      statusDiv.style.backgroundColor = '#ffeef0';
      statusDiv.style.color = '#cb2431';
    }

    statusDiv.textContent = `Status: ${dataObj.status} ${dataObj.statusText || ''}`;
    responseArea.appendChild(statusDiv);
  }

  if (!rawBody.trim()) return;

  try {
    const parsed = JSON.parse(rawBody);

    const rootDetails = document.createElement('details');
    rootDetails.open = true;
    const summary = document.createElement('summary');
    summary.textContent = Array.isArray(parsed) ? `JSON Array (${parsed.length} items)` : 'JSON Root Object';
    rootDetails.appendChild(summary);
    rootDetails.appendChild(createJsonTree(parsed));

    responseArea.appendChild(rootDetails);
  } catch (e) {
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-all';
    pre.textContent = rawBody;
    responseArea.appendChild(pre);
  }
}

// オブジェクトをフラット化（キー・パス展開）する補助関数
function flattenObject(obj, prefix = '') {
  let flattened = {};
  if (!obj || typeof obj !== 'object') return { [prefix]: obj };

  Object.keys(obj).forEach((key) => {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];

    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(flattened, flattenObject(val, keyPath));
    } else if (Array.isArray(val)) {
      flattened[keyPath] = JSON.stringify(val);
    } else {
      flattened[keyPath] = val;
    }
  });

  return flattened;
}

// CSVエスケープ処理
function escapeCsvCell(cell) {
  const str = String(cell ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// 初回読み込み
chrome.storage.local.get('latestApiResponse', (result) => {
  if (result.latestApiResponse) {
    displayData(result.latestApiResponse);
  }
});

// Storage監視
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.latestApiResponse) {
    displayData(changes.latestApiResponse.newValue);
  }
});

// メッセージ受信
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'refresh') {
    displayData(request.data);
  }
});

// --- 起点オブジェクトからの行列CSV変換処理 ---
downloadBtn.addEventListener('click', () => {
  let csvRows = [];

  try {
    const parsed = JSON.parse(currentData);

    // パターン1: トップレベルが配列の場合
    if (Array.isArray(parsed)) {
      const flattenedArray = parsed.map((item) => typeof item === 'object' ? flattenObject(item) : { value: item });
      const allHeaders = Array.from(new Set(flattenedArray.flatMap(obj => Object.keys(obj))));

      csvRows.push(allHeaders.map(escapeCsvCell).join(','));

      flattenedArray.forEach((item) => {
        const row = allHeaders.map(h => escapeCsvCell(item[h] ?? ''));
        csvRows.push(row.join(','));
      });
    } 
    // パターン2: トップレベルが単一のオブジェクトの場合（起点固定＋内部配列の行展開）
    else if (typeof parsed === 'object' && parsed !== null) {
      const rootObject = {};
      let targetArrayKey = null;
      let targetArray = null;

      // 親オブジェクトの属性と内部の配列項目を切り分け
      Object.keys(parsed).forEach((key) => {
        if (Array.isArray(parsed[key]) && targetArray === null) {
          targetArrayKey = key;
          targetArray = parsed[key];
        } else {
          rootObject[key] = parsed[key];
        }
      });

      const flatRoot = flattenObject(rootObject);

      // 配列要素が存在する場合：起点（親）情報 ＋ 配列要素を行毎に結合
      if (targetArray && targetArray.length > 0) {
        const flatArrayItems = targetArray.map((item, idx) => {
          if (typeof item === 'object' && item !== null) {
            return flattenObject(item, targetArrayKey);
          }
          return { [`${targetArrayKey}[${idx}]`]: item };
        });

        const arrayHeaders = Array.from(new Set(flatArrayItems.flatMap(obj => Object.keys(obj))));
        const allHeaders = [...Object.keys(flatRoot), ...arrayHeaders];

        csvRows.push(allHeaders.map(escapeCsvCell).join(','));

        flatArrayItems.forEach((arrayItem) => {
          const row = allHeaders.map((header) => {
            if (header in flatRoot) {
              return escapeCsvCell(flatRoot[header] ?? '');
            }
            return escapeCsvCell(arrayItem[header] ?? '');
          });
          csvRows.push(row.join(','));
        });
      } 
      // 配列が含まれない単純オブジェクトの場合：1行として出力
      else {
        const allHeaders = Object.keys(flatRoot);
        csvRows.push(allHeaders.map(escapeCsvCell).join(','));
        csvRows.push(allHeaders.map(h => escapeCsvCell(flatRoot[h] ?? '')).join(','));
      }
    }

  } catch (e) {
    // 非JSONデータ（プレーンテキスト）の場合
    csvRows.push(['Line Number', 'Text Content'].map(escapeCsvCell).join(','));
    const lines = currentData.split(/\r?\n/);
    lines.forEach((line, index) => {
      csvRows.push([escapeCsvCell(index + 1), escapeCsvCell(line)].join(','));
    });
  }

  const csvContent = csvRows.join('\r\n');

  // UTF-8 BOM付きでダウンロード実行
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `api_response_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
