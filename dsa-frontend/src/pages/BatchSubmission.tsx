import React, { useState, useEffect } from 'react';
import { fetchLectures } from '../api/GetAPI';
import { submitBatchEvaluation } from '../api/PostAPI';
import FileUploadBox from '../components/FileUploadBox';
import { Lecture } from '../types/Assignments';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import { useNavigate } from 'react-router-dom';

const BatchSubmission: React.FC = () => {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [selectedLecture, setSelectedLecture] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const { token } = useAuth();
  const { apiClient } = useApiClient();
  const navigate = useNavigate();
  
  useEffect(() => {
    const fetchAllLectures = async () => {
      try {
        const allLectures = await apiClient({ apiFunc: fetchLectures, args: [true]});
        setLectures(allLectures);
      } catch (error) {
        console.error('Error fetching lectures:', error);
      }
    }

    console.log(lectures);
    fetchAllLectures();
  }, [token]);

  const handleSubmit = async (files: File[]) => {
    if (isSubmitting) {
      return;
    }

    if (files.length !== 1) {
      setError('ファイルは一つだけアップロードしてください');
      return;
    }

    const uploadedFile = files[0];
    if (!uploadedFile.name.endsWith('.zip')) {
      setError('ファイルはzipファイルを選択してください');
      return;
    }

    if (selectedLecture === "") {
      setError('課題を選択し、zipファイルをアップロードしてください');
      return;
    }

    try {
      setIsSubmitting(true);
      await apiClient({ apiFunc: submitBatchEvaluation, args: [Number(selectedLecture), true, uploadedFile]});
      alert('バッチ採点が正常に提出されました');
      setSelectedLecture('');
      navigate('/batch/status'  );
    } catch (error) {
      console.error('Error submitting batch evaluation:', error);
      setError('バッチ採点の提出に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="batch-submission">
      <h1>バッチ採点</h1>
      <div>
        <label htmlFor='lecture-select'>課題選択: </label>
        <select
          id='lecture-select'
          value={selectedLecture}
          onChange={(e) => setSelectedLecture(Number(e.target.value) || '')}
        >
          <option value="">選択してください</option>
          {lectures.map((lecture) => (
            <option key={lecture.id} value={lecture.id}>
              {lecture.title}
            </option>
          ))}
        </select>
      </div>
      <div>
      </div>
      <FileUploadBox
        onSubmit={handleSubmit}
        descriptionOnBox='zipファイル一つをアップロードしてください'
        isSubmitting={isSubmitting}
      />
      {error && <p className='error'>{error}</p>}
    </div>
  );
}

export default BatchSubmission;
