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
        details.open = true; // デフォルトで展開

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

  // データ構造がオブジェクト（{status, body, ...}）かテキストか判定
  const rawBody = typeof dataObj === 'string' ? dataObj : (dataObj.body || '');
  currentData = rawBody; // CSV用にボディデータをセット

  // ステータス情報の表示用ヘッダーを作成
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
    // JSONパースを試みる
    const parsed = JSON.parse(rawBody);

    const rootDetails = document.createElement('details');
    rootDetails.open = true;
    const summary = document.createElement('summary');
    summary.textContent = Array.isArray(parsed) ? `JSON Array (${parsed.length} items)` : 'JSON Root Object';
    rootDetails.appendChild(summary);
    rootDetails.appendChild(createJsonTree(parsed));

    responseArea.appendChild(rootDetails);
  } catch (e) {
    // JSONでない場合はそのままテキスト表示
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-all';
    pre.textContent = rawBody;
    responseArea.appendChild(pre);
  }
}

// JSONオブジェクトをフラットなキー・パスと値の配列に変換する関数
function flattenJson(data, prefix = '') {
  let rows = [];

  if (data === null || data === undefined) {
    rows.push([prefix, '']);
    return rows;
  }

  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      if (data.length === 0) {
        rows.push([prefix, '[]']);
      } else {
        data.forEach((item, index) => {
          const keyPath = prefix ? `${prefix}[${index}]` : `[${index}]`;
          if (item !== null && typeof item === 'object') {
            rows = rows.concat(flattenJson(item, keyPath));
          } else {
            rows.push([keyPath, String(item ?? '')]);
          }
        });
      }
    } else {
      const keys = Object.keys(data);
      if (keys.length === 0) {
        rows.push([prefix, '{}']);
      } else {
        keys.forEach((key) => {
          const keyPath = prefix ? `${prefix}.${key}` : key;
          const val = data[key];
          if (val !== null && typeof val === 'object') {
            rows = rows.concat(flattenJson(val, keyPath));
          } else {
            rows.push([keyPath, String(val ?? '')]);
          }
        });
      }
    }
  } else {
    rows.push([prefix, String(data)]);
  }

  return rows;
}

// CSVエスケープ処理（カンマや改行、ダブルクォーテーションに対応）
function escapeCsvCell(cell) {
  const str = String(cell ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// 初回読み込み：storageから取得
chrome.storage.local.get('latestApiResponse', (result) => {
  if (result.latestApiResponse) {
    displayData(result.latestApiResponse);
  }
});

// storageの更新を監視（タブが開いた直後の更新に対応）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.latestApiResponse) {
    displayData(changes.latestApiResponse.newValue);
  }
});

// ポップアップからの直接メッセージ受信用
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'refresh') {
    displayData(request.data);
  }
});

// CSVダウンロード処理
downloadBtn.addEventListener('click', () => {
  let csvRows = [];

  try {
    const parsed = JSON.parse(currentData);

    // パターン1: 配列（Array）形式で、要素がオブジェクトの場合（表形式で出力）
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
      const allHeaders = [];
      parsed.forEach(obj => {
        if (obj && typeof obj === 'object') {
          Object.keys(obj).forEach(k => {
            if (!allHeaders.includes(k)) {
              allHeaders.push(k);
            }
          });
        }
      });

      // ヘッダー行を追加
      csvRows.push(allHeaders.map(escapeCsvCell).join(','));

      // 各データ行を追加
      parsed.forEach(obj => {
        const row = allHeaders.map(header => {
          const val = obj ? obj[header] : '';
          if (val !== null && typeof val === 'object') {
            return escapeCsvCell(JSON.stringify(val));
          }
          return escapeCsvCell(val);
        });
        csvRows.push(row.join(','));
      });

    } else {
      // パターン2: 階層オブジェクト形式の場合（キー・パス列 と 値列 に分解して出力）
      csvRows.push(['キー / パス (Key/Path)', '値 (Value)'].map(escapeCsvCell).join(','));

      const flatData = flattenJson(parsed);
      flatData.forEach(([keyPath, val]) => {
        csvRows.push([escapeCsvCell(keyPath), escapeCsvCell(val)].join(','));
      });
    }

  } catch (e) {
    // JSON以外（プレーンテキスト・HTML等）の場合は1セルに1行ずつ分割出力
    csvRows.push(['行番号', 'テキスト内容'].map(escapeCsvCell).join(','));
    const lines = currentData.split(/\r?\n/);
    lines.forEach((line, index) => {
      csvRows.push([escapeCsvCell(index + 1), escapeCsvCell(line)].join(','));
    });
  }

  const csvContent = csvRows.join('\r\n');

  // BOM付与（Excel文字化け防止）してダウンロード実行
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
