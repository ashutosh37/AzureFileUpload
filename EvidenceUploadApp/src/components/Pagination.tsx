interface PaginationProps {
  displayedContainerForFiles: string;
  displayedItemsCount: number;
  prevPageTokens: (string | null)[];
  nextPageToken: string | null;
  isLoadingFiles: boolean;
  handlePreviousPage: () => void;
  handleNextPage: () => void;
}

export const Pagination: React.FC<PaginationProps> = ({
  displayedContainerForFiles,
  displayedItemsCount,
  prevPageTokens,
  nextPageToken,
  isLoadingFiles,
  handlePreviousPage,
  handleNextPage,
}) => {
  if (!displayedContainerForFiles || (displayedItemsCount === 0 && prevPageTokens.length <= 1 && !nextPageToken)) {
    return null;
  }

  return (
    <div className="flex justify-between items-center mt-4 p-2 border-t border-gray-200">
      <button
        onClick={handlePreviousPage}
        disabled={prevPageTokens.length <= 1 || isLoadingFiles}
        className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-3 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        &larr; Previous
      </button>
      <span className="text-gray-600 text-sm">
        {isLoadingFiles ? "Loading..." : `Page ${prevPageTokens.length}`}
      </span>
      <button
        onClick={handleNextPage}
        disabled={!nextPageToken || isLoadingFiles}
        className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1 px-3 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Next &rarr;
      </button>
    </div>
  );
};