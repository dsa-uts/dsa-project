import React, { useState, useRef } from 'react';
import { uploadStudentList } from '../api/PostAPI';
import useApiClient from '../hooks/useApiClient';
import { match } from 'assert';

const StudentListUpload: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isNameCorrect, setIsNameCorrect] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [downloadFileName, setDownloadFileName] = useState<string>(''); // ファイル名を動的に設定
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { apiClient } = useApiClient();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setIsNameCorrect(null);
        const files = event.target.files;
        processFile(files);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const files = event.dataTransfer.files;
        processFile(files);
        setError(null);
    };

    const processFile = (files: FileList | null) => {
        if (files && files[0]) {
            const selectedFile = files[0];
            setFile(selectedFile);
            if (selectedFile.name.endsWith('.csv') || selectedFile.name.endsWith('.xlsx')) {
                setIsNameCorrect(true);
            } else {
                setIsNameCorrect(false);
            }
        }
    };

    const handleCancel = () => {
        setFile(null);
        setIsNameCorrect(null);
        setError(null);
        setDownloadUrl(null);
        setDownloadFileName(''); // ダウンロードファイル名をリセット
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (file && isNameCorrect) {
            setIsUploading(true);
            setError(null);
            setDownloadUrl(null);

            try {
                const { data: blob, headers } = await apiClient({ apiFunc: uploadStudentList, args: [file] });

                console.log('headers', headers);
                
                // Content-Dispositionヘッダーからファイル名を取得
                // TODO: 現状はCORSの設定により、カスタムヘッダーが取得できないため、
                //       contentDispositionがundefinedになってしまう。
                const contentDisposition = headers['content-disposition'];
                // console.log('contentDisposition', contentDisposition);
                let fileName = 'downloaded_file.xlsx';

                if (contentDisposition) {
                    const filenameRegex = /filename="([^"]+)"/;
                    const matches = filenameRegex.exec(contentDisposition);
                    if (matches != null && matches[1]) {
                        fileName = matches[1];
                    }
                }
                // console.log('extracted fileName', fileName);

                setDownloadFileName(fileName); // 動的に取得したファイル名を設定
                const url = window.URL.createObjectURL(blob);
                setDownloadUrl(url);
            } catch (error) {
                console.error('Error uploading file', error);
                setError('Failed to upload the file.');
            } finally {
                setIsUploading(false); // アップロード完了後、ボタンを再度有効化
            }
        }
    };

    return (
        <>
            <div
                style={{
                    backgroundColor: '#f0f0f0',
                    padding: '20px',
                    borderRadius: '5px',
                    border: '1px solid #ddd',
                    textAlign: 'center',
                    minHeight: '150px',
                }}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <p>{file ? file.name : 'ファイルを選択してください'}</p>
                <p style={{ color: 'red', minHeight: '20px' }}>
                    {isNameCorrect !== null && !isNameCorrect ? `ファイルはcsvかxlsxのものを選択してください．` : ''}
                </p>

                {error && <p style={{ color: 'red', margin: '5px 0', padding: '8px', backgroundColor: '#ffebee', borderRadius: '4px' }}>{error}</p>}

                {downloadUrl && file && (
                    <div style={{
                        margin: '10px 0',
                        padding: '10px',
                        backgroundColor: '#e3f2fd',
                        borderRadius: '4px'
                    }}>
                        <p style={{ marginBottom: '5px' }}>ユーザー登録が完了しました</p>
                        <a
                            href={downloadUrl}
                            download={downloadFileName}
                            style={{
                                color: '#1976d2',
                                textDecoration: 'underline',
                                fontWeight: 'bold'
                            }}
                        >
                            パスワードリストをダウンロード
                        </a>
                    </div>
                )}
                <input type="file" onChange={handleFileChange} ref={fileInputRef} style={{ display: 'none' }} />
                <button
                    disabled={isUploading}
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ width: 'auto', padding: '10px', margin: '10px 0' }}
                >
                    ファイルを選択
                </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px' }}>
                <button
                    type="button"
                    onClick={handleCancel}
                    disabled={!file || isUploading}
                    style={{ width: 'auto', padding: '10px' }}
                >
                    選択取り消し
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!file || !isNameCorrect || isUploading}
                    style={{ width: 'auto', padding: '10px' }}
                >
                    {isUploading ? 'アップロード中...' : 'アップロード'}
                </button>
            </div>
        </>
    );
};

export default StudentListUpload;
