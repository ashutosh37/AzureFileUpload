import { useState, useEffect, type ChangeEvent } from 'react';
import type { BackendFileInfo, DisplayItem } from '../interfaces';
import * as apiService from '../services/apiService';

interface UseFileListingProps {
  initialContainerName?: string;
  initialFolderPath?: string;
  accessToken: string | null;
  getAuthHeaders: (isFormData?: boolean) => HeadersInit;
  setUploadStatus: (status: string) => void;
  setUploadError: (error: string) => void;
}

export function useFileListing({
  initialContainerName,
  initialFolderPath,
  accessToken,
  getAuthHeaders,
  setUploadStatus,
  setUploadError,
}: UseFileListingProps) {
  const [rawBlobList, setRawBlobList] = useState<BackendFileInfo[]>([]);
  const [displayedItems, setDisplayedItems] = useState<DisplayItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<string>('displayName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [prevPageTokens, setPrevPageTokens] = useState<(string | null)[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [lastClickedFileIndex, setLastClickedFileIndex] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<DisplayItem | null>(null);
  const [displayedContainerForFiles, setDisplayedContainerForFiles] = useState<string>('');

  const fetchAndSetRawFiles = async (containerToFetch: string) => {
    if (!containerToFetch || !accessToken) {
      setUploadError("Container name and authentication are required to fetch files.");
      return;
    }

    setIsLoadingFiles(true);
    setUploadError('');

    if (displayedContainerForFiles !== containerToFetch) {
      setCurrentPath('');
      setRawBlobList([]);
      setDisplayedItems([]);
      setSelectedItem(null);
      setPrevPageTokens([]);
      setNextPageToken(null);
      setLastClickedFileIndex(null);
      setSelectedFiles([]);
      setSortColumn('displayName');
      setSortDirection('asc');
    }

    try {
      const data: { items: BackendFileInfo[]; nextContinuationToken: string | null } = await apiService.listFiles(containerToFetch, getAuthHeaders);
      setRawBlobList(data.items);
      setNextPageToken(data.nextContinuationToken);
      setPrevPageTokens([null]);
      setDisplayedContainerForFiles(containerToFetch);
    } catch (error) {
      setRawBlobList([]);
      setDisplayedItems([]);
      setNextPageToken(null);
      setUploadError(error instanceof Error ? `Error fetching files: ${error.message}` : 'An unknown error occurred while fetching files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const goToPage = async (token: string | null) => {
    if (!displayedContainerForFiles) return;

    setIsLoadingFiles(true);
    setUploadError('');
    setSelectedItem(null);
    setSelectedFiles([]);

    try {
      const data: { items: BackendFileInfo[]; nextContinuationToken: string | null } = await apiService.listFiles(displayedContainerForFiles, getAuthHeaders, token);
      setRawBlobList(data.items);
      setNextPageToken(data.nextContinuationToken);
    } catch (error) {
      setRawBlobList([]);
      setDisplayedItems([]);
      setNextPageToken(null);
      setUploadError(error instanceof Error ? `Error fetching files: ${error.message}` : 'An unknown error occurred while fetching files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    const itemsMap = new Map<string, DisplayItem>();
    rawBlobList.forEach(blob => {
      if (blob.name.startsWith(currentPath)) {
        const relativePath = blob.name.substring(currentPath.length);
        const segments = relativePath.split('/');
        const firstSegment = segments[0];

        if (segments.length > 1) {
          const folderFullPath = currentPath + firstSegment;
          if (!itemsMap.has(folderFullPath)) {
            itemsMap.set(folderFullPath, { id: folderFullPath, displayName: firstSegment, fullPath: folderFullPath, isFolder: true, checksum: "N/A" });
          }
        } else {
          itemsMap.set(blob.name, { id: blob.name, displayName: firstSegment, fullPath: blob.name, isFolder: false, checksum: blob.checksum, metadata: blob.metadata });
        }
      }
    });

    const getSortValue = (item: DisplayItem, column: string): any => {
      if (item.isFolder && column !== 'displayName') return '';
      switch (column) {
        case 'displayName': return item.displayName;
        case 'checksum': return item.checksum;
        case 'documentId': case 'createdDate': case 'modifiedDate': case 'createdBy': case 'modifiedBy': return item.metadata?.[column] || '';
        default: return '';
      }
    };

    const sortedItems = Array.from(itemsMap.values()).sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      const aValue = getSortValue(a, sortColumn);
      const bValue = getSortValue(b, sortColumn);
      return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    });

    setDisplayedItems(sortedItems);
  }, [rawBlobList, currentPath, sortColumn, sortDirection]);

  useEffect(() => {
    if (initialContainerName && accessToken) {
      fetchAndSetRawFiles(initialContainerName);
    }
    if (initialFolderPath) {
      setCurrentPath(initialFolderPath);
    }
  }, [initialContainerName, initialFolderPath, accessToken]);

  const handleSort = (column: string) => {
    setSortDirection(prev => (sortColumn === column && prev === 'asc' ? 'desc' : 'asc'));
    setSortColumn(column);
  };

  const handleGoUp = () => {
    if (currentPath === '') return;
    const pathSegments = currentPath.slice(0, -1).split('/');
    pathSegments.pop();
    setCurrentPath(pathSegments.length > 0 ? pathSegments.join('/') + '/' : '');
    setSelectedItem(null);
  };

  const handleBreadcrumbClick = (pathSegment: string) => {
    setCurrentPath(pathSegment);
    setSelectedItem(null);
  };

  const handleNextPage = () => nextPageToken && goToPage(nextPageToken);
  const handlePreviousPage = () => {
    if (prevPageTokens.length <= 1) return;
    const newPrevPageTokens = prevPageTokens.slice(0, -1);
    goToPage(newPrevPageTokens[newPrevPageTokens.length - 1]);
    setPrevPageTokens(newPrevPageTokens);
  };

  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>, clickedItem: DisplayItem, currentIndex: number) => {
    const { checked } = event.target;
    const clickedFilePath = clickedItem.fullPath;

    if ((event.nativeEvent as MouseEvent).shiftKey && lastClickedFileIndex !== null) {
      const start = Math.min(lastClickedFileIndex, currentIndex);
      const end = Math.max(lastClickedFileIndex, currentIndex);

      const filesInCurrentView = displayedItems.filter(item => !item.isFolder);
      const pathsToToggle = filesInCurrentView.slice(start, end + 1).map(item => item.fullPath);

      setSelectedFiles(prevSelected => {
        const newSelected = new Set(prevSelected);
        if (checked) {
          pathsToToggle.forEach(path => newSelected.add(path));
        } else {
          pathsToToggle.forEach(path => newSelected.delete(path));
        }
        return Array.from(newSelected);
      });
    } else {
      setSelectedFiles(prevSelected => {
        if (checked) {
          return [...prevSelected, clickedFilePath];
        } else {
          return prevSelected.filter(path => path !== clickedFilePath);
        }
      });
      setLastClickedFileIndex(currentIndex);
    }
  };

  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.target;
    const allFilePaths = displayedItems.filter(item => !item.isFolder).map(item => item.fullPath);
    setSelectedFiles(checked ? allFilePaths : []);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0 || !window.confirm(`Are you sure you want to delete the selected ${selectedFiles.length} files? This action cannot be undone.`)) {
      return;
    }

    setUploadStatus(`Deleting ${selectedFiles.length} files...`);
    setUploadError('');

    try {
      const deletePromises = selectedFiles.map(blobName => apiService.deleteFile(displayedContainerForFiles, blobName, getAuthHeaders));
      const responses = await Promise.all(deletePromises);

      if (responses.every(response => response.ok)) {
        setUploadStatus(`${selectedFiles.length} files were deleted successfully.`);
      } else {
        const errorDetails = await Promise.all(responses.filter(r => !r.ok).map(r => r.text()));
        console.error("Some files failed to delete:", errorDetails);
        setUploadError(`Some files failed to delete. Check the console for details.`);
      }

      fetchAndSetRawFiles(displayedContainerForFiles);
      setSelectedFiles([]);
    } catch (error) {
      setUploadError(error instanceof Error ? `Error deleting files: ${error.message}` : 'Could not delete files.');
    } finally {
      setUploadStatus('');
    }
  };

  return { displayedItems, currentPath, isLoadingFiles, displayedContainerForFiles, nextPageToken, prevPageTokens, sortColumn, sortDirection, selectedItem, selectedFiles, fetchAndSetRawFiles, handleSort, handleGoUp, handleBreadcrumbClick, handleNextPage, handlePreviousPage, setCurrentPath, setSelectedItem, handleCheckboxChange, handleSelectAll, handleBulkDelete };
}