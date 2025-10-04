import { useAuth } from '../context/AuthContext';
import { updateToken } from '../api/GetAPI';

const useApiClient = () => {
    const { token, setToken, logout } = useAuth();

    const refreshAccessToken = async (): Promise<string | null> => {
        try {
            const response = await updateToken(token);
            if (response) {
                const newToken = response;
                setToken(newToken);
                return newToken;
            }
        } catch (error) {
            console.error('トークンのリフレッシュに失敗しました:', error);
            return null;
        }
        return null;
    };

    const apiClient = async <T>({
        apiFunc,
        args = []
    }: {
        apiFunc: (...args: any[]) => Promise<T>,
        args?: any[]
    }): Promise<T> => {
        // 引数がtokenを必要とする場合、tokenを自動的に追加
        const needsToken = apiFunc.length > args.length; // 引数にtokenが必要かどうかを判定
        const adjustedArgs = needsToken ? [...args, token] : args;
        try {
            // API関数を実行
            return await apiFunc(...adjustedArgs);
        } catch (error: any) {
            const status = error.response?.status;
            const detail = error.response?.data?.detail;
            console.log('status:', status);
            console.log('detail:', detail);
            if (status === 401 && detail === "Token has expired") {
                console.log("Token refreshed")
                const refreshedToken = await refreshAccessToken();
                if (refreshedToken) {
                    const adjustedArgs = needsToken ? [...args, refreshedToken] : args;
                    return await apiFunc(...adjustedArgs); // トークンをリフレッシュ後に再試行
                } else {
                    logout();
                    throw new Error('セッションが切れました。再度ログインしてください。');
                }
            } else if (status === 400 && detail === "現在のパスワードが正しくありません") {
                throw error;
            } else if (status === 403 || status === 401) {
                alert("許可されていないページまたは操作です．")
                logout();
            }else if (status !== 200){
                console.error('APIリクエストエラー:', error);
                const errorMessage = '予期せぬエラーが発生しました。再度ログインしてください。';
                alert(errorMessage);
                logout();
            }
            throw error;
        }
    };

    return { apiClient };
};

export default useApiClient;
