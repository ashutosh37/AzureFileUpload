import type { ChangeEvent } from 'react';
import type { DisplayItem } from '../interfaces';
import { formatDate, getFileIcon } from '../utils/utilities';
import { FolderIcon, DeleteIcon } from '../icons';

interface FileListingProps {
  displayedItems: DisplayItem[];
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (column: string) => void;
  selectedItem: DisplayItem | null;
  setSelectedItem: (item: DisplayItem | null) => void;
  handleItemAction: (item: DisplayItem) => void;
  handleDeleteClick: (item: DisplayItem, event: React.MouseEvent) => void;
  selectedFiles: string[];
  handleCheckboxChange: (event: ChangeEvent<HTMLInputElement>, clickedItem: DisplayItem, currentIndex: number) => void;
  handleSelectAll: (event: ChangeEvent<HTMLInputElement>) => void;
}

export const FileListing: React.FC<FileListingProps> = ({
  displayedItems,
  sortColumn,
  sortDirection,
  handleSort,
  selectedItem,
  setSelectedItem,
  handleItemAction,
  handleDeleteClick,
  selectedFiles,
  handleCheckboxChange,
  handleSelectAll,
}) => {
  return (
    <div className="overflow-auto flex-grow">
      <p className="mb-2 text-sm text-gray-500">Items: {displayedItems.length}</p>
      <table className="min-w-full divide-y divide-gray-200 shadow-sm rounded-md overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('displayName')}>
              Name
              {sortColumn === 'displayName' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('documentId')}>
              Document ID
              {sortColumn === 'documentId' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('createdDate')}>
              Created Date
              {sortColumn === 'createdDate' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('modifiedDate')}>
              Modified Date
              {sortColumn === 'modifiedDate' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('modifiedBy')}>
              Modified By
              {sortColumn === 'modifiedBy' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            {/* <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('checksum')}>
              Checksum
              {sortColumn === 'checksum' && (
                <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </th> */}
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <input type="checkbox" onChange={handleSelectAll} checked={selectedFiles.length === displayedItems.filter(item => !item.isFolder).length && displayedItems.filter(item => !item.isFolder).length > 0} />
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
        {displayedItems.map((item, index) => (
          <tr 
            key={item.id} 
            className={`hover:bg-gray-100 cursor-pointer ${selectedItem?.id === item.id ? 'bg-blue-100' : ''}`}
            onClick={() => setSelectedItem(item)}
            onDoubleClick={() => handleItemAction(item)}
          >
            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-left">
              <span className="flex items-center">
                {item.isFolder ? <FolderIcon /> : getFileIcon(item.displayName)}
                {item.displayName}
              </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
              {!item.isFolder ? (item.metadata?.documentId || 'N/A') : ''}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
              {!item.isFolder ? formatDate(item.metadata?.createdDate) : ''}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
              {!item.isFolder ? formatDate(item.metadata?.modifiedDate) : ''}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
              {!item.isFolder ? (item.metadata?.modifiedBy || 'N/A') : ''}
            </td>
            {/* <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
              {item.checksum}
            </td> */}
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {!item.isFolder && (
                <button 
                  onClick={(e) => handleDeleteClick(item, e)} 
                  className="p-1 rounded-md hover:bg-red-100"
                  title={`Delete ${item.displayName}`}
                >
                  <DeleteIcon />
                </button>
              )}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {!item.isFolder && (
                    <input
                        type="checkbox"
                        value={item.fullPath}
                        onChange={(e) => handleCheckboxChange(e, item, index)}
                        checked={selectedFiles.includes(item.fullPath)} // Check if the item's fullPath is in selectedFiles
                    />
                )}
            </td>
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
};