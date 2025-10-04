import axios from 'axios';
import { Lecture, Problem, Submission, FileRecord, BatchSubmission, EvaluationStatus, BatchSubmissionItemsForListView, BatchSubmissionDetailItem } from '../types/Assignments';
import { User } from '../types/user';
import { Token } from '../types/token';
import { TextResponse } from '../types/response'
import JSZip from 'jszip';
import { SubmissionStatusQuery } from '../types/Assignments';
import { API_PREFIX } from '../constants/constants';

// "/api/v1/assignments/info?all={true|false}"を通して、{全て|公開期間内}の授業エントリを全て取得する関数
export const fetchLectures = async (all: boolean, token: string | null): Promise<Lecture[]> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<Lecture[]>(`${API_PREFIX}/assignments/info?all=${all}`, { headers });
        // start_dateとend_dateをDate型に変換
        response.data.forEach((lecture) => {
            lecture.start_date = new Date(lecture.start_date);
            lecture.end_date = new Date(lecture.end_date);
        });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


// "/api/v1/assignments/info/{lecture_id}"を通して、授業のエントリの詳細を取得する関数
export const fetchLectureEntry = async (lecture_id: number, token: string | null): Promise<Lecture> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<Lecture>(`${API_PREFIX}/assignments/info/${lecture_id}`, { headers });
        // start_dateとend_dateをDate型に変換
        response.data.start_date = new Date(response.data.start_date);
        response.data.end_date = new Date(response.data.end_date);
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


// "/api/v1/assignments/info/{lecture_id}/{assignment_id}/entry"を通して、課題のエントリの詳細を取得する関数。
export const fetchProblemEntry = async (lecture_id: number, assignment_id: number, token: string | null): Promise<Problem> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<Problem>(`${API_PREFIX}/assignments/info/${lecture_id}/${assignment_id}/entry`, { headers });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


// "/api/v1/assignments/info/{lecture_id}/{assignment_id}/detail?eval={true|false}"を通して、課題のエントリの詳細を取得する関数。
// eval=Trueなら評価用の追加リソース(テストケースなど)も取得される
export const fetchProblemDetail = async (lecture_id: number, assignment_id: number, evaluation: boolean, token: string | null): Promise<Problem> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<Problem>(`${API_PREFIX}/assignments/info/${lecture_id}/${assignment_id}/detail?eval=${evaluation}`, { headers });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


// "api/v1/assignments/status/submissions/id/{submission_id}"を通じて、指定された提出の進捗状況を取得する関数
export const fetchSubmissionStatus = async (submission_id: number, token: string | null): Promise<Submission> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<Submission>(`${API_PREFIX}/assignments/status/submissions/id/${submission_id}`, { headers });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};

// "/api/v1/assignments/status/submissions/view"を通じて、自分の提出の進捗状況を取得する関数
/*
 * クエリパラメータ:
 * page: ページ番号
 * all: 全てのユーザの提出を含めるかどうか
 * user: user_idまたはusernameの部分一致検索
 * ts_order: 提出のtsのソート順(asc: 古い順, desc: 新しい順)
 * lecture_id: 講義IDを指定して取得する
 * assignment_id: 課題IDを指定して取得する
 * result: 提出結果の条件, "WJ"は未評価の提出を表す
 */
export const fetchSubmissionList = async (page: number, all: boolean, user: string | null, ts_order: "asc" | "desc", lecture_id: number | null, assignment_id: number | null, result: SubmissionStatusQuery | null, token: string | null): Promise<Submission[]> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        let request_url = `${API_PREFIX}/assignments/status/submissions/view?page=${page}&all=${all}`;
        if (user !== null) request_url += `&user=${user}`;
        request_url += `&ts_order=${ts_order}`;
        if (lecture_id !== null) request_url += `&lecture_id=${lecture_id}`;
        if (assignment_id !== null) request_url += `&assignment_id=${assignment_id}`;
        if (result !== null) request_url += `&result=${result}`;
        const response = await axios.get<Submission[]>(request_url, { headers });
        // tsはstring型なのでDate型に変換
        response.data.forEach((submission) => {
            submission.ts = new Date(submission.ts);
        });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


const textFileExtensions = [
    ".txt", ".json", ".js", ".ts", ".html", ".css", ".md", ".py", ".java", ".c",
    ".cpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".scala", 
    ".vb", ".sql", ".pl", ".r", ".sh", ".h", "Makefile", "makefile", 
    "GNUMakefile"];

const hasTextExtension = (filename: string): boolean => {
    return textFileExtensions.some(ext => filename.toLowerCase().includes(ext.toLowerCase()));
}

// "/api/v1/assignments/status/submissions/id/{submission_id}/files/zip?type={uploaded|arranged}"を通じて、ジャッジリクエストに関連するファイルのリストを取得する関数
export const fetchSubmissionFiles = async (submission_id: number, type: "uploaded" | "arranged", token: string | null): Promise<{files: FileRecord[], zipBlob: Blob}> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/zip' } : {};
        const response = await axios.get(`${API_PREFIX}/assignments/status/submissions/id/${submission_id}/files/zip?type=${type}`, { headers, responseType: 'arraybuffer' });

        //console.log("response.data", response.data);
        
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(response.data);

        //console.log("解凍したファイルの数", Object.keys(loadedZip.files).length);

        // ファイルの名前をconsole.logする
        Object.keys(loadedZip.files).forEach((fileName) => {
            //console.log("ファイルの名前", fileName);
        });

        const files: FileRecord[] = await Promise.all(
            Object.keys(loadedZip.files).map(async (fileName) => {
                let file = loadedZip.files[fileName];
                let content: string | Blob;
                if (hasTextExtension(fileName)) {
                    content = await file.async('string');
                    //console.log("ファイルの名前[string]: ", fileName);
                } else {
                    content = await file.async('blob');
                    //console.log("ファイルの名前[blob]: ", fileName);
                }
                return { name: fileName, content };
            })
        );

        const zipBlob = new Blob([response.data], { type: 'application/zip' });
        return { files, zipBlob };

    } catch (error: any) {
        console.error("提出ファイルの取得に失敗しました", error);
        throw error;
    }
};


// "/api/v1/assignments/result/submissions/id/{submission_id}"を通じて、提出されたジャッジの結果の詳細を取得する関数
export const fetchSubmissionResultDetail = async (submission_id: number, token: string | null): Promise<Submission> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<Submission>(`${API_PREFIX}/assignments/result/submissions/id/${submission_id}`, { headers });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


// "api/v1/assignments/status/batch/id/{batch_id}"を通じて、指定されたバッチ採点の結果を取得する関数
export const fetchBatchSubmissionStatus = async (batch_id: number, token: string | null): Promise<BatchSubmission> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<BatchSubmission>(`${API_PREFIX}/assignments/status/batch/id/${batch_id}`, { headers });
        return response.data;
    } catch (error: any) {
        console.error("指定されたバッチ採点の結果の取得に失敗しました", error);
        throw error;
    }
};


// "/api/v1/assignments/status/batch/all?page={page}"を通じて、バッチ採点の進捗状況のリストを取得する関数
export const fetchBatchSubmissionList = async (page: number, page_size: number, lecture_title: string | null, user: string | null, sort_by: string | null, sort_order: string | null, token: string | null): Promise<BatchSubmissionItemsForListView> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const params = new URLSearchParams({
            page: page.toString(),
            page_size: page_size.toString()
        });

        if (lecture_title !== null && lecture_title !== undefined) params.append('lecture_title', lecture_title);
        if (user !== null && user !== undefined) params.append('user', user);
        if (sort_by !== null && sort_by !== undefined) params.append('sort_by', sort_by);
        if (sort_order !== null && sort_order !== undefined) params.append('sort_order', sort_order);
        const response = await axios.get<BatchSubmissionItemsForListView>(`${API_PREFIX}/assignments/status/batch/all`, { 
            headers,
            params
        });
        return response.data;
    } catch (error: any) {
        console.error("バッチ採点の結果のリストの取得に失敗しました", error);
        throw error;
    }
};


// "/api/v1/assignments/result/batch/id/{batch_id}"を通じて、指定されたバッチ採点の結果の詳細を取得する関数
export const fetchBatchSubmissionDetail = async (batch_id: number, token: string | null): Promise<BatchSubmissionDetailItem> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<BatchSubmissionDetailItem>(`${API_PREFIX}/assignments/result/batch/id/${batch_id}`, { headers });
        return response.data;
    } catch (error: any) {
        console.error("指定されたバッチ採点の結果の詳細の取得に失敗しました", error);
        throw error;
    }
};


// "/api/v1/assignments/result/batch/id/{batch_id}/user/{user_id}"を通じて、指定されたバッチ採点の結果の詳細を取得する関数
export const fetchEvaluationStatus = async (batch_id: number, user_id: string, token: string | null): Promise<EvaluationStatus> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<EvaluationStatus>(`${API_PREFIX}/assignments/result/batch/id/${batch_id}/user/${user_id}`, { headers });
        return response.data;
    } catch (error: any) {
        console.error("指定されたバッチ採点の結果の詳細の取得に失敗しました", error);
        throw error;
    }
};


// "/api/v1/assignments/result/batch/{batch_id}/files/uploaded/{user_id}"を通じて、特定のバッチ採点の特定の学生が提出したファイルを取得する関数
export const fetchBatchSubmissionUserUploadedFile = async (batch_id: number, user_id: string, token: string | null): Promise<{files: FileRecord[], zipBlob: Blob}> => {
    try {
        // ZIPで受け取る
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/zip' } : {};
        const response = await axios.get(`${API_PREFIX}/assignments/result/batch/${batch_id}/files/uploaded/${user_id}`, { headers, responseType: 'arraybuffer' });
        

        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(response.data);

        Object.keys(loadedZip.files).forEach((fileName) => {
            console.log("ファイルの名前", fileName);
        });

        const files: FileRecord[] = await Promise.all(
            Object.keys(loadedZip.files).map(async (fileName) => {
                let file = loadedZip.files[fileName];
                let content: string | Blob;
                if (hasTextExtension(fileName)) {
                    content = await file.async('string');
                    //console.log("ファイルの名前[string]: ", fileName);
                } else if (fileName.endsWith("Makefile") || fileName.endsWith("makefile") || fileName.endsWith("GNUmakefile")) {
                    content = await file.async('string');
                    //console.log("ファイルの名前[string]: ", fileName);
                } else {
                    content = await file.async('blob');
                    //console.log("ファイルの名前[blob]: ", fileName);
                }
                return { name: fileName, content };
            })
        );

        // ArrayBufferからBlobを作成
        const zipBlob = new Blob([response.data], { type: 'application/zip' });

        return { files, zipBlob };
    } catch (error: any) {
        console.error("特定のバッチ採点の特定の学生が提出したファイルの取得に失敗しました", error);
        throw error;
    }
};


// "/api/v1/assignments/result/batch/{batch_id}/files/report/{user_id}"を通じて、指定されたバッチ採点の特定の学生のレポートを取得する関数
export const fetchBatchSubmissionUserReport = async (batch_id: number, user_id: string, token: string | null): Promise<FileRecord> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/pdf' } : {};
        const response = await axios.get(`${API_PREFIX}/assignments/result/batch/${batch_id}/files/report/${user_id}`, { headers, responseType: 'arraybuffer' });
        
        const blob = new Blob([response.data], { type: 'application/pdf' });
        
        // Content-Dispositionヘッダーからファイル名を抽出
        const contentDisposition = response.headers['content-disposition'];
        let fileName = 'report.pdf';
        if (contentDisposition) {
            const fileNameMatch = contentDisposition.match(/filename="?(.+)"?/i);
            if (fileNameMatch) {
                fileName = fileNameMatch[1];
            }
        }
        
        return {
            name: fileName,
            content: blob
        };
    } catch (error: any) {
        console.error("指定されたバッチ採点の特定の学生のレポートの取得に失敗しました", error);
        throw error;
    }
}


// "/api/v1/assignments/problem/download?lecture_id={lecture_id}?problem_id={problem_id}"を通じて、小課題のzipファイルをダウンロードする
export const downloadProblem = async (lecture_id: number, problem_id: number, token: string | null): Promise<{ data: Blob, headers: any }> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(`${API_PREFIX}/assignments/problem/download?lecture_id=${lecture_id}&problem_id=${problem_id}`, { headers, responseType: 'blob' });
        return { data: response.data, headers: response.headers };
    } catch (error: any) {
        console.error('Error downloading problem:', error);
        throw error;
    }
}


// "/api/v1/assignments/problem/template"を通じて、小課題のテンプレートをダウンロードする
export const downloadTemplate = async (token: string | null): Promise<{ data: Blob, headers: any }> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(`${API_PREFIX}/assignments/problem/template`, { headers, responseType: 'blob' });
        return { data: response.data, headers: response.headers };
    } catch (error: any) {
        console.error('Error downloading template:', error);
        throw error;
    }
}


export const fetchUserList = async (user_id: string | null, roles: string[] | null, token: string | null): Promise<User[]> => {
    // select * from Users where user_id = user_id or role in roles
    // /users/all?user_id={user_id}&role={role1,role2,...}
    try {
        let url = `${API_PREFIX}/users/all`;
        if (user_id !== null) {
            url += `?user_id=${user_id}`;
        }
        if (roles !== null) {
            url += `&role=${roles.join(',')}`;
        }
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        throw error;
    }
};


export const fetchUserInfo = async (user_id: string, token: string | null): Promise<User> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<User>(`${API_PREFIX}/users/info/${user_id}`, { headers });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


export const fetchMyUserInfo = async (token: string | null): Promise<User> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}`, accept: 'application/json' } : {};
        const response = await axios.get<User>(`${API_PREFIX}/users/me`, { headers });
        return response.data;
    } catch (error: any) {
        throw error;
    }
};


export const updateToken = async (token: string | null): Promise<string> => {
    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get<Token>(`${API_PREFIX}/authorize/token/update`, {
            headers,
            withCredentials: true // クッキーを送信するために必要
        });
        return response.data.access_token;
    } catch (error) {
        console.error('トークンの更新に失敗しました', error);
        throw error;
    }
};