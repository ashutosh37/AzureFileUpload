import React from 'react';

interface BreadcrumbsProps {
  currentPath: string;
  handleBreadcrumbClick: (pathSegment: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
 currentPath,
 handleBreadcrumbClick,
}) => {
  if (!currentPath) return null; // Don't render if there's no path

  const pathSegments = currentPath.slice(0, -1).split('/').filter(Boolean);

  return (
    <div className="flex items-center">
      {pathSegments.map((segment, index, array) => {
        const pathSoFar = array.slice(0, index + 1).join('/') + '/';
        const isLastSegment = index === array.length - 1;
        return (
          <span key={pathSoFar} className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mx-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {isLastSegment ? (
              <span className="font-medium text-gray-700">{segment}</span>
            ) : (
              // Using an anchor tag for semantics, but preventing default browser navigation
              // to handle it via client-side state updates.
              <a href="#" onClick={(e) => { e.preventDefault(); handleBreadcrumbClick(pathSoFar); }} className="text-blue-600 hover:underline">{segment}</a>
            )}
          </span>
        );
      })}
    </div>
  );
 };