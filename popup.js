document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('optionsContainer');
  const apiUrlInput = document.getElementById('apiUrl');
  const urlHistorySelect = document.getElementById('urlHistory');

  // --- URL履歴処理 ---
  const MAX_HISTORY = 5;
  const updateHistoryDropdown = (historyList) => {
    urlHistorySelect.innerHTML = '<option value="">-- 過去に使用したURLから選択 --</option>';
    historyList.forEach(url => {
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = url;
      urlHistorySelect.appendChild(opt);
    });
  };

  const { urlHistory = [] } = await chrome.storage.local.get('urlHistory');
  updateHistoryDropdown(urlHistory);

  urlHistorySelect.addEventListener('change', (e) => {
    if (e.target.value) apiUrlInput.value = e.target.value;
  });

  const saveUrlToHistory = async (newUrl) => {
    const data = await chrome.storage.local.get('urlHistory');
    let history = data.urlHistory || [];
    history = history.filter(url => url !== newUrl);
    history.unshift(newUrl);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    await chrome.storage.local.set({ urlHistory: history });
    updateHistoryDropdown(history);
  };

  // --- 認証方式の切り替え処理 ---
  const authTypeSelect = document.getElementById('authType');
  const authInputContainer = document.getElementById('authInputContainer');
  const authInput = document.getElementById('authInfo');
  const toggleAuthBtn = document.getElementById('toggleAuthBtn');

  authTypeSelect.addEventListener('change', (e) => {
    const type = e.target.value;
    if (type === 'none') {
      authInputContainer.style.display = 'none';
      authInput.value = '';
    } else {
      authInputContainer.style.display = 'flex';
      if (type === 'bearer') authInput.placeholder = 'Bearerトークン文字列（Bearerの入力は不要）';
      else if (type === 'jwt') authInput.placeholder = 'eyJhbGciOi... (JWT文字列)';
      else if (type === 'oauth2') authInput.placeholder = 'OAuth 2.0 アクセストークン';
    }
  });

  // マスク切替処理
  if (toggleAuthBtn) {
    toggleAuthBtn.addEventListener('click', () => {
      if (authInput.type === 'password') {
        authInput.type = 'text';
        toggleAuthBtn.textContent = '🙈';
      } else {
        authInput.type = 'password';
        toggleAuthBtn.textContent = '👁️';
      }
    });
  }

  // --- オプション入力行の追加・削除 ---
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('add-btn')) {
      const newRow = document.createElement('div');
      newRow.className = 'option-row';
      newRow.innerHTML = `
        <input type="text" class="opt-key" placeholder="Key">
        <input type="text" class="opt-val" placeholder="Value">
        <button type="button" class="btn-small add-btn">＋</button>
        <button type="button" class="btn-small remove-btn">ー</button>
      `;
      container.appendChild(newRow);
    } else if (e.target.classList.contains('remove-btn')) {
      const rows = container.querySelectorAll('.option-row');
      if (rows.length > 1) {
        e.target.closest('.option-row').remove();
      }
    }
  });

  // --- 「送信」ボタン押下処理 ---
  document.getElementById('sendBtn').addEventListener('click', async () => {
    const url = apiUrlInput.value.trim();
    const method = document.getElementById('httpMethod').value.trim() || 'GET';
    const authType = authTypeSelect.value;
    const rawAuthValue = authInput.value.trim();

    if (!url) {
      alert('URLを入力してください');
      return;
    }

    await saveUrlToHistory(url);

    // オプション項目の収集
    const headers = {};
    const rows = container.querySelectorAll('.option-row');
    rows.forEach(row => {
      const key = row.querySelector('.opt-key').value.trim();
      const val = row.querySelector('.opt-val').value.trim();
      if (key) headers[key] = val;
    });

    // 認証ヘッダーの付与制御
    if (authType !== 'none' && rawAuthValue) {
      if (authType === 'bearer' || authType === 'jwt' || authType === 'oauth2') {
        // 先頭に Bearer が付いていなければ自動補完
        const token = rawAuthValue.replace(/^Bearer\s+/i, '');
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    // APIリクエストの実行
    let responseData = {
      status: null,
      statusText: '',
      headers: {},
      body: ''
    };

    try {
      const response = await fetch(url, {
        method: method,
        headers: headers
      });

      // レスポンスヘッダーの取得
      const resHeaders = {};
      response.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      const rawText = await response.text();

      responseData = {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
        body: rawText
      };

    } catch (err) {
      responseData = {
        status: 'Error',
        statusText: 'Network Error',
        headers: {},
        body: `[API Fetch Error]\n${err.message}\n\n※URLやCORS制限、認証情報をご確認ください。`
      };
    }

    // データの保存と結果用タブの処理
    await chrome.storage.local.set({ 'latestApiResponse': responseData });
    const targetUrl = chrome.runtime.getURL('response.html');

    const tabs = await chrome.tabs.query({ url: targetUrl });
    if (tabs.length > 0) {
      const targetTabId = tabs[0].id;
      chrome.tabs.sendMessage(targetTabId, { action: 'refresh', data: responseData });
      chrome.tabs.update(targetTabId, { active: true });
    } else {
      chrome.tabs.create({ url: 'response.html' });
    }
  });
});
