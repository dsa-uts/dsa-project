import axios from 'axios';
import { LoginCredentials, CreateUser, UserUpdatePassword } from '../types/user';
import { Token, TokenResponse } from '../types/token';
import { Submission, BatchSubmission } from '../types/Assignments';
import { MessageResponse } from '../types/response';
import { API_PREFIX } from '../constants/constants';

interface UploadResult {
    unique_id: string;
    filename: string;
    result: string;
}


// "/api/v1/assignments/judge/{lecture_id}/{assignment_id}/?eval={true|false}"を通して、課題のジャッジリクエストを送信する関数
// eval=Trueの場合は、採点リソースも使用して採点を行う
export const submitAssignment = async (lecture_id: number, assignment_id: number, evaluation: boolean, files: File[], token: string | null) : Promise<Submission> => {
    const formData = new FormData();
    files.forEach(file => {
        formData.append('file_list', file);
    });

    try {
        const headers = token ? {
            Authorization: `Bearer ${token}`,
            accept: 'application/json',
            'Content-Type': 'multipart/form-data'
        } : {};
        const response = await axios.post<Submission>(`${API_PREFIX}/assignments/judge/${lecture_id}/${assignment_id}?eval=${evaluation}`, formData, { headers });
        return response.data;
    } catch (error: any) {
        console.error('Error submitting assignment:', error);
        if (error.response) {
            console.error('Server responded with an error:', error.response.data);
        } else if (error.request) {
            console.error('No response received from the server:', error.request);
        } else {
            console.error('Error during the request:', error.message);
        }
        throw error;
    }
}


// "/api/v1/assignments/judge/{lecture_id}?eval={true|false}"を通じて、学生のzip提出を受け付ける関数(学生はeval=falseの場合しか提出できない)
// eval=Trueの場合は、採点リソースも使用して採点を行う
export const submitStudentZip = async (lecture_id: number, evaluation: boolean, upload_zip_file: File, token: string | null): Promise<Submission[]> => {
    const formData = new FormData();
    formData.append('uploaded_zip_file', upload_zip_file);

    try {
        const headers = token ? {
            Authorization: `Bearer ${token}`,
            accept: 'application/json',
            'Content-Type': 'multipart/form-data'
        } : {};
        const response = await axios.post<Submission[]>(`${API_PREFIX}/assignments/judge/${lecture_id}?eval=${evaluation}`, formData, { headers });
        return response.data;
    } catch (error: any) {
        console.error('Error submitting student zip:', error);
        if (error.response) {
            console.error('Server responded with an error:', error.response.data);
        } else if (error.request) {
            console.error('No response received from the server:', error.request);
        } else {
            console.error('Error during the request:', error.message);
        }
        throw error;
    }
}


// "/api/v1/assignments/batch/{lecture_id}?eval={true|false}"を通じて、バッチ採点をリクエストする関数
// eval=Trueの場合は、採点リソースも使用して採点を行う
export const submitBatchEvaluation = async (lecture_id: number, evaluation: boolean, uploaded_zip_file: File, token: string | null): Promise<BatchSubmission> => {
    const formData = new FormData();
    formData.append('uploaded_zip_file', uploaded_zip_file);

    try {
        const headers = token ? { Authorization: `Bearer ${token}` , accept: 'application/json', 'Content-Type': 'multipart/form-data'} : {};
        const response = await axios.post<BatchSubmission>(`${API_PREFIX}/assignments/batch/${lecture_id}?eval=${evaluation}`, formData, { headers });
        return response.data;
    } catch (error: any) {
        console.error('Error submitting batch evaluation:', error);
        if (error.response) {
            console.error('Server responded with an error:', error.response.data);
        } else if (error.request) {
            console.error('No response received from the server:', error.request);
        } else {
            console.error('Error during the request:', error.message);
        }
        throw error;
    }
}


// "/api/v1/assignments/problem/add?lecture_id={lecture_id}?lecture_title={lecture_title}?lecture_start_date={lecture_start_date}?lecture_end_date={lecture_end_date}?is_update={true|false}"
// を通じて、課題エントリに追加・更新、および小課題の新規追加を行う
export const mergeLectureAndAddProblem = async (lecture_id: number, lecture_title: string, lecture_start_date: Date, lecture_end_date: Date, is_update: boolean, upload_file: File | null,token: string | null): Promise<MessageResponse> => {
    const formData = new FormData();
    // is_updateがTrueの場合は、upload_fileを追加する
    if (upload_file !== null) {
        formData.append("upload_file", upload_file);
    } else {
        // ファイルが無い場合は、空のファイルを追加する
        formData.append("upload_file", new File([], "empty.zip"));
    }

    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json', 'Content-Type': 'multipart/form-data'} : {};
        // lecture_title, lecture_start_date, lecture_end_dateにはエスケープしなければならない文字があるので
        // それらをエスケープしてから送信する
        const lecture_title_escaped = encodeURIComponent(lecture_title);
        const lecture_start_date_escaped = encodeURIComponent(lecture_start_date.toISOString());
        const lecture_end_date_escaped = encodeURIComponent(lecture_end_date.toISOString());
        const response = await axios.post<MessageResponse>(`${API_PREFIX}/assignments/problem/add?lecture_id=${lecture_id}&lecture_title=${lecture_title_escaped}&lecture_start_date=${lecture_start_date_escaped}&lecture_end_date=${lecture_end_date_escaped}&is_update=${is_update}`, formData, { headers });
        return response.data;
    } catch (error: any) {
        console.error('Error merging lecture and adding problem:', error);
        if (error.response) {
            console.error('Server responded with an error:', error.response.data);
        } else if (error.request) {
            console.error('No response received from the server:', error.request);
        } else {
            console.error('Error during the request:', error.message);
        }
        throw error;
    }
}

// "/api/v1/assignments/problem/update?lecture_id={lecture_id}"を通じて、小課題の更新を行う
export const updateProblem = async (lecture_id: number, upload_file: File, token: string | null): Promise<MessageResponse> => {
    const formData = new FormData();
    formData.append("upload_file", upload_file);

    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json', 'Content-Type': 'multipart/form-data'} : {};
        const response = await axios.post<MessageResponse>(`${API_PREFIX}/assignments/problem/update?lecture_id=${lecture_id}`, formData, { headers });
        return response.data;
    } catch (error: any) {
        console.error('Error updating problem:', error);
        if (error.response) {
            console.error('Server responded with an error:', error.response.data);
        } else if (error.request) {
            console.error('No response received from the server:', error.request);
        } else {
            console.error('Error during the request:', error.message);
        }
        throw error;
    }
}


export const uploadStudentList = async (file: File, token: string | null): Promise<{ data: Blob, headers: any }> => {
    const formData = new FormData();
    formData.append("upload_file", file);

    try {
        const response = await axios.post(`${API_PREFIX}/users/register/multiple`, formData, {
            headers: {
                "Content-Type": "multipart/form-data",
                "Authorization": `Bearer ${token}`
            },
            responseType: 'blob' // ファイルを受け取るために blob を指定
        });

        return { data: response.data, headers: response.headers }; // Blobデータをそのまま返す
    } catch (error: any) {
        if (error.response) {
            console.error("Server responded with an error:", error.response.data);
        } else if (error.request) {
            console.error("No response received from the server:", error.request);
        } else {
            console.error("Error during the request:", error.message);
        }
        throw error;
    }
};
// 
export const createUser = async (user: CreateUser, token: string | null): Promise<string> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.post(`${API_PREFIX}/users/register`, user, { headers });
        return response.data.result;
    } catch (error) {
        throw error;
    }
}

// ログイン関数
export const login = async (credentials: LoginCredentials): Promise<Token> => {
    const formData = new FormData();
    formData.append('username', credentials.user_id);
    formData.append('password', credentials.password);

    try {
        const response = await axios.post<Token>(`${API_PREFIX}/authorize/token`, formData, {
            withCredentials: true // クッキーを送信するために必要
        });
        return response.data; 
    } catch (error) {
        throw error;
    }
}

export const logout = async (token: string): Promise<void> => {
    try {
        const headers = { Authorization: `Bearer ${token}` };
        await axios.post(`${API_PREFIX}/authorize/logout`, {}, { headers,
            withCredentials: true // クッキーを送信するために必要
        });
    } catch (error) {
        throw error;
    }
}

export const validateToken = async (token: string): Promise<boolean> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.post<TokenResponse>(`${API_PREFIX}/authorize/token/validate`, {}, { headers });
        return response.data.is_valid;
    } catch (error) {
        console.error('Token validation error:', error);
        throw error;
    }
};

export const updateUserInfo = async (user: CreateUser, token: string | null): Promise<void> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.post(`${API_PREFIX}/users/update/user`, user, { headers });
        return response.data.result;
    } catch (error) {
        throw error;
    }
}

export const updatePassword = async (user: UserUpdatePassword, token: string | null): Promise<void> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.post(`${API_PREFIX}/users/update/password`, user, { headers });
        
        // サーバーからのレスポンスを確認し、必要に応じて処理を追加
        if (response.status === 200) {
            console.log('パスワードが正常に更新されました');
        } else {
            console.error('パスワード更新に失敗しました');
        }
    } catch (error: any) {
        throw error;
    }
}
