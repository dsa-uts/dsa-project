import { ProgressMessage } from '../types/Assignments';

const API_WS_PREFIX = 'ws://localhost:8000/api/v1';

interface WebSocketCallbacks {
    onProgress: (progress: ProgressMessage) => void;
}

export const startProcessingWithProgress = (
    id: number,
    sub_id: number,
    filename: string,
    unique_id: string,
    { onProgress }: WebSocketCallbacks
) => {
    const ws = new WebSocket(`${API_WS_PREFIX}/assignments/ws/${id}/${sub_id}`);
    let lastHeartbeat = Date.now();
    let processingCompleted = false;
    let heartbeatTimerId: NodeJS.Timeout | null = null;

    const checkHeartbeat = () => {
        if (ws.readyState === WebSocket.CLOSED && processingCompleted) {
            return; // WebSocketが閉じている場合は、チェックを中止
        }
        if (heartbeatTimerId !== null) {
            clearTimeout(heartbeatTimerId);
        }
        const now = Date.now();
        if (now - lastHeartbeat > 20000) {  // 最後のハートビートから20秒以上経過している場合
            console.error("Connection lost or server is down");
            onProgress({ status: 'error', message: 'サーバーとの接続が切れました. 再度アップロードボタンを押して再試行してください．', progress_percentage: -1 });
            ws.close();
        } else {
            setTimeout(checkHeartbeat, 5000);  // 5秒後に再度チェック
        }
    };

    ws.onopen = () => {
        // WebSocket接続が開かれたら、filenameを送信
        ws.send(JSON.stringify({ filename , unique_id}));
        setTimeout(checkHeartbeat, 10000);  // 接続後10秒後に最初のハートビートチェックを開始
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data);
            if (data.type === "heartbeat" && data.message === "ping") {
                lastHeartbeat = Date.now();  // ハートビートのタイムスタンプを更新
            } else {
                onProgress(data);
                if (data.status === 'done') {
                    processingCompleted = true;
                }
            }
        } catch (error) {
            console.error('Error parsing message:', error);
            onProgress({ status: 'error', message: 'メッセージの解析に失敗しました．', progress_percentage: -1 });
        }
    };

    ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        onProgress({ status: 'error', message: 'WebSocketエラーが発生しました．', progress_percentage: -1 });
    };

    ws.onclose = (event) => {
        if (heartbeatTimerId !== null) {
            clearTimeout(heartbeatTimerId);
        }
        if (!event.wasClean) {
            console.error('WebSocket closed with error:', event);
            onProgress({ status: 'error', message: 'WebSocketが予期せず閉じました. 再度アップロードボタンを押して再試行してください.', progress_percentage: -1 });
        }
    };

    // WebSocket接続を閉じる関数を返す
    return () => {
        ws.close();
    };
};