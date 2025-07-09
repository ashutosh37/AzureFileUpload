import React from 'react';

interface BreadcrumbsProps {
  currentPath: string;
 initialFolderPath?: string;
  handleBreadcrumbClick: (pathSegment: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
 currentPath,
 initialFolderPath,
 handleBreadcrumbClick,
}) => {
  if (!currentPath) return null; // Don't render if there's no path

 const pathSegments = currentPath.slice(0, -1).split('/');


  return (
    <>
      {pathSegments.map((segment, index, array) => {
        const pathSoFar = array.slice(0, index + 1).join('/') + '/';
        const isLastSegment = index === array.length - 1;
        // Only allow navigation of breadcrumbs if not within the initial folder path
        const isWithinInitialFolder = initialFolderPath ? pathSoFar.startsWith(initialFolderPath) : false;
        return (
          <span key={pathSoFar}>
            {' > '}
            {isLastSegment || isWithinInitialFolder ? <span className="text-gray-700">{segment}</span> : (
              <span className="text-blue-600 hover:underline cursor-pointer" onClick={() => handleBreadcrumbClick(pathSoFar)}>{segment}</span>
            )}
          </span>
        );
      })}
    </>
  );
 };