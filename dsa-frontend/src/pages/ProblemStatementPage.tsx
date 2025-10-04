import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useNavigate, useParams } from "react-router";
import NotFoundPage from "./NotFound";
import { useAuthMutation, useAuthQuery } from "../auth/hooks";
import type { JSX } from "react";
import SubmitFormSection from "../components/SubmitFormSection";
import type { CompressedFileData } from "../types/FileData";

interface ProblemDetail {
  lecture_id: number;
  problem_id: number;
  title: string;
  description: string;
  time_ms: number;
  memory_mb: number;
  required_files: string[];
  test_files: CompressedFileData[];
};

const renderProblemDetail = (detail: ProblemDetail, handleOnSubmit: (files: File[]) => Promise<void>, isUploading: boolean): JSX.Element => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">

            {/* Meta information of problem */}
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-500">
                Lecture {detail.lecture_id}
              </span>
              <span className="text-sm text-gray-300">•</span>
              <span className="text-sm text-gray-500">
                Problem {detail.problem_id}
              </span>
            </div>

            {/* Execution Time / Memory Limit */}
            <div className="flex items-center space-x-4 text-sm">
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-gray-600">{detail.time_ms} ms</span>
              </div>
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-gray-600">{detail.memory_mb} MB</span>
              </div>
            </div>

          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-gray-900 mt-4">
            {detail.title}
          </h1>
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content - Problem Description */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">問題文</h2>
            </div>

            <div className="p-6">
              {/* Markdown Content with Typography */}
              <div className="prose prose-sm max-w-none
                                prose-headings:text-gray-900
                                prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-4 prose-h1:mt-6
                                prose-h2:text-xl prose-h2:font-semibold prose-h2:mb-3 prose-h2:mt-5
                                prose-h3:text-lg prose-h3:font-semibold prose-h3:mb-2 prose-h3:mt-4
                                prose-p:text-gray-700 prose-p:leading-7 prose-p:mb-4
                                prose-strong:text-gray-900
                                prose-pre:bg-[rgb(40,44,52)] prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:p-4
                                prose-ul:list-disc prose-ul:pl-6 prose-ul:my-4
                                prose-ol:list-decimal prose-ol:pl-6 prose-ol:my-4
                                prose-li:text-gray-700 prose-li:my-1">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Customization of code block
                    pre: ({ children }) => (
                      <div className="relative group">
                        <pre className="overflow-x-auto">{children}</pre>
                        <button
                          className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
                          onClick={(e) => {
                            const code = e.currentTarget.parentElement?.querySelector('code')?.textContent;
                            if (code) navigator.clipboard.writeText(code);
                          }}
                        >Copy</button>
                      </div>
                    ),
                    // Customization of inline code
                    code: ({ children, className, node, ...rest }) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const isCodeBlock = !!match;
                      const language = isCodeBlock ? match[1] : '';
                      if (isCodeBlock) {
                        // return <code className="px-0 py-0.5 rounded text-sm" {...rest}>{children}</code>
                        return (
                          <SyntaxHighlighter
                            // refを除くrest
                            className="text-base"
                            PreTag="pre"
                            children={String(children).replace(/\n$/, '')}
                            language={language}
                            style={oneDark}
                          />
                        )
                      }
                      return (
                        <code className="bg-gray-100 text-pink-600 px-1 py-0.5 rounded text-sm before:content-[''] after:content-['']" {...rest}>
                          {children}
                        </code>
                      );
                    },
                    // Customization of link
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 no-underline hover:underline inline-flex items-center gap-1"
                      >
                        {children}
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ),
                  }}
                >
                  {detail.description}
                </Markdown>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - Required Files & Submit */}
        <div className="lg:col-span-1 space-y-6">
          {/* Required Files */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">Required Files</h3>
            </div>
            <div className="p-4">
              <ul className="space-y-2">
                {detail.required_files.map((file, index) => (
                  <li key={index} className="flex items-center space-x-2">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Submit Form Section */}
          <SubmitFormSection
            onSubmit={handleOnSubmit}
            isLoading={isUploading}
          />
        </div>
      </div>
    </div>
  )
}

// url: /problem/:lectureid/:problemid
const ProblemStatementPage: React.FC = () => {
  const { lectureid, problemid } = useParams<{ lectureid: string; problemid: string }>();

  const navigate = useNavigate();

  // TODO: Should we check the validity of params before querying?
  const isValidLectureId = !!lectureid && !isNaN(parseInt(lectureid, 10));
  const isValidProblemId = !!problemid && !isNaN(parseInt(problemid, 10));

  const problemDetailQuery = useAuthQuery<ProblemDetail>({
    queryKey: [`problemDetail-${lectureid}-${problemid}`],
    endpoint: `/problem/fetch/detail/${lectureid}/${problemid}`,
    options: {
      queryOptions: {
        retry: 1,
        staleTime: 1000 * 60 * 5, // 5 minutes
      },
    },
  });

  const isPending = problemDetailQuery.isPending;
  const problemDetail = problemDetailQuery.data;
  const error = problemDetailQuery.error;

  const submitMutation = useAuthMutation<any, FormData>({
    endpoint: `/problem/validate/${lectureid}/${problemid}`,
    options: {
      method: 'POST',
      axiosConfig: {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
      mutationOptions: {
        onSuccess: (data) => {
          console.log("Submission successful:", data);
        },
        onError: (error) => {
          console.error("Submission error:", error);
        },
      },
    },
  });

  const handleOnSubmit = async (files: File[]) => {
    const formData = new FormData();

    // TODO: restrict file size and type

    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      const result = await submitMutation.mutateAsync(formData);
      console.log("Submission successful:", result);

      // TODO: move to result page.
      navigate(`/validation/results`);
    } catch (error) {
      console.error("Submission error:", error);
    }
  }

  if (!isValidLectureId || !isValidProblemId) {
    return <NotFoundPage />;
  } else if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  } else if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Problem not found</div>
      </div>
    );
  } else {
    return renderProblemDetail(problemDetail!, handleOnSubmit, submitMutation.isPending);
  }
}

export default ProblemStatementPage;

