document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('optionsContainer');
  const apiUrlInput = document.getElementById('apiUrl');
  const urlHistorySelect = document.getElementById('urlHistory');

  // --- ★ここから：URL履歴の読み込みと選択処理 ---
  const MAX_HISTORY = 5;

  // 履歴ドロップダウンの表示更新関数
  const updateHistoryDropdown = (historyList) => {
    urlHistorySelect.innerHTML = '<option value="">-- 過去に使用したURLから選択 --</option>';
    historyList.forEach(url => {
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = url;
      urlHistorySelect.appendChild(opt);
    });
  };

  // 初期読み込み時に保存済み履歴を取得してセット
  const { urlHistory = [] } = await chrome.storage.local.get('urlHistory');
  updateHistoryDropdown(urlHistory);

  // ドロップダウンからURLが選択されたら入力欄に反映
  urlHistorySelect.addEventListener('change', (e) => {
    if (e.target.value) {
      apiUrlInput.value = e.target.value;
    }
  });

  // URLを履歴に保存する処理関数
  const saveUrlToHistory = async (newUrl) => {
    const data = await chrome.storage.local.get('urlHistory');
    let history = data.urlHistory || [];
    
    // 既に存在するURLなら一度取り除いて最新を先頭にする
    history = history.filter(url => url !== newUrl);
    history.unshift(newUrl);

    // 最大5個までに制限
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    await chrome.storage.local.set({ urlHistory: history });
    updateHistoryDropdown(history);
  };
  // --- ★ここまで：URL履歴の処理 ---

  // 認証情報のマスク切替処理
  const authInput = document.getElementById('authInfo');
  const toggleAuthBtn = document.getElementById('toggleAuthBtn');
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

  // オプション入力行の追加・削除イベントの制御
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

  // 「送信」ボタン押下処理
  document.getElementById('sendBtn').addEventListener('click', async () => {
    const url = apiUrlInput.value.trim();
    const auth = document.getElementById('authInfo').value.trim();
    const method = document.getElementById('httpMethod').value.trim() || 'GET';

    if (!url) {
      alert('URLを入力してください');
      return;
    }

    // ★リクエスト成功／失敗に関わらず送信時にURL履歴を保存
    await saveUrlToHistory(url);

    // オプション項目の収集
    const options = {};
    const rows = container.querySelectorAll('.option-row');
    rows.forEach(row => {
      const key = row.querySelector('.opt-key').value.trim();
      const val = row.querySelector('.opt-val').value.trim();
      if (key) {
        options[key] = val;
      }
    });

    // APIリクエストの実行
    let rawResponseText = '';
    try {
      const headers = { ...options };
      if (auth) {
        headers['Authorization'] = auth;
      }

      // fetchを実行（CORSエラー対策で mode を指定）
      const response = await fetch(url, {
        method: method,
        headers: headers
      });

      // レスポンスのテキストを取得
      rawResponseText = await response.text();

      // HTTPエラー（4xx, 5xx等）の場合でもレスポンスボディを表示に含める
      if (!response.ok) {
        rawResponseText = `[HTTP Status: ${response.status} ${response.statusText}]\n\n${rawResponseText}`;
      }
    } catch (err) {
      console.error('Fetch error:', err);
      rawResponseText = `[API Fetch Error]\n${err.message}\n\n※URLやネットワーク接続、またはCORS制限を確認してください。`;
    }

    // データの保存と結果用タブの処理
    await chrome.storage.local.set({ 'latestApiResponse': rawResponseText });
    const targetUrl = chrome.runtime.getURL('response.html');

    const tabs = await chrome.tabs.query({ url: targetUrl });
    if (tabs.length > 0) {
      const targetTabId = tabs[0].id;
      chrome.tabs.sendMessage(targetTabId, { action: 'refresh', data: rawResponseText });
      chrome.tabs.update(targetTabId, { active: true });
    } else {
      chrome.tabs.create({ url: 'response.html' });
    }
  });
});