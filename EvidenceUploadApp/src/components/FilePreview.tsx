import React, { useState, useEffect } from 'react';
import type { DisplayItem } from '../interfaces';
import * as apiService from '../services/apiService';

interface FilePreviewProps {
  item: DisplayItem | null;
  containerName: string;
  accessToken: string | null;
  getAuthHeaders: (isFormData?: boolean) => HeadersInit;
}

export const FilePreview: React.FC<FilePreviewProps> = ({
  item,
  containerName,
  accessToken,
  getAuthHeaders,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [messageContent, setMessageContent] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state when item is deselected or is a folder
    if (!item || item.isFolder) {
      setPreviewUrl(null);
      setError(null);
      setMessageContent(null);
      setIsLoading(false);
      return;
    }
    const fileType = item.displayName.split('.').pop()?.toLowerCase();
    const isMessageFile = fileType === 'msg' || fileType === 'eml' || fileType === 'pst' || fileType === 'mbox';
    // Fetch a new preview URL when the item or token changes
    if (accessToken) {
      setIsLoading(true);
      setPreviewUrl(null);
      setMessageContent(null);
      setError(null);

      const fetchPreview = async () => {
        if (isMessageFile) {
            try {
              const messageData = await apiService.getMessageFileContent(containerName, item.fullPath, getAuthHeaders);
              setMessageContent(messageData);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not load message content.');
            } finally {
              setIsLoading(false);
            }
        }
        try {
          const sasData = await apiService.generateReadSAS(containerName, item.fullPath, getAuthHeaders);
          setPreviewUrl(sasData.fullDownloadUrl);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not load preview.');
        } finally {
          setIsLoading(false);
        }
      };

      fetchPreview();
    }
  }, [item, containerName, accessToken, getAuthHeaders]);

  if (!item || item.isFolder) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg">
        <p className="text-gray-500">Select a file to see a preview.</p>
      </div>
    );
  }

  if (messageContent) {
    return (
      <div className="h-full flex flex-col">
        <h4 className="text-lg font-semibold text-gray-800 p-4 border-b truncate">
          {item.displayName}
        </h4>
        <div className="flex-grow flex flex-col bg-gray-50 p-4 overflow-y-auto">
          <p className="text-gray-700 font-semibold">Subject: {messageContent.subject}</p>
          {messageContent.html ? (
            <iframe
              srcDoc={messageContent.html}
              title="Message Body Preview"
              className="w-full h-full mt-2 border-0 bg-white"
              sandbox="" // sandbox for security to block scripts and other potentially harmful content
            />
          ) : (
            <p className="text-gray-600 mt-2 whitespace-pre-line">{messageContent.text}</p>
          )}
        </div>
      </div>
    );
  }
  const renderPreview = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      );
    }

    if (error) {
      return <p className="text-red-500 text-center">Error: {error}</p>;
    }

    if (!previewUrl) {
      return <p className="text-gray-500">No preview available.</p>;
    }

    const fileType = item.displayName.split('.').pop()?.toLowerCase();
    const imageTypes = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];
    const wordTypes = ['doc', 'docx','ppt' , 'pptx', 'xls', 'xlsx'];
    const videoTypes = ['mp4', 'webm', 'mov', 'ogv'];
    const audioTypes = ['mp3', 'wav', 'ogg', 'm4a'];

    if (imageTypes.includes(fileType || '')) {
      return <img src={previewUrl} alt={item.displayName} className="max-w-full max-h-full object-contain" />;
    }

    if (fileType === 'pdf') {
      return <iframe src={previewUrl} title={item.displayName} className="w-full h-full border-0" />;
    }

    if (fileType === 'html' || fileType === 'txt') {
      return <iframe src={previewUrl} title={item.displayName} className="w-full h-full border-0" />;
    }

    if (wordTypes.includes(fileType || '')) {
      const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`;
      return <iframe src={officeViewerUrl} title={item.displayName} className="w-full h-full border-0" />;
    }

    if (videoTypes.includes(fileType || '')) {
      return <video src={previewUrl} controls className="max-w-full max-h-full" />;
    }

    if (audioTypes.includes(fileType || '')) {
      return <audio src={previewUrl} controls className="w-full" />;
    }

    return (
      <div className="text-center">
        <p className="text-gray-500 mb-4">No direct preview available for this file type.</p>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-150 ease-in-out"
        >
          Download File
        </a>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* <h4 className="text-lg font-semibold text-gray-800 p-4 border-b truncate">{item.displayName}</h4> */}
      <div className="flex-grow flex items-center justify-center bg-gray-50 p-4">
        {renderPreview()}
      </div>
    </div>
  );
};