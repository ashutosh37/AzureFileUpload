import { FolderIcon } from "../icons";
import { useState, useMemo, type ChangeEvent } from "react";
import { formatDate, getFileIcon } from "../utils/utilities";
import type { DisplayItem } from "../interfaces";

interface FileListingProps {
  displayedItems: DisplayItem[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  handleSort: (column: string) => void;
  selectedItem: DisplayItem | null;
  setSelectedItem: (item: DisplayItem | null) => void;
  handleItemAction: (item: DisplayItem) => void;
  handleDeleteClick: (item: DisplayItem, event: React.MouseEvent) => void;
  selectedFiles: string[];
  handleCheckboxChange: (
    event: React.ChangeEvent<HTMLInputElement>,
    clickedItem: DisplayItem,
    currentIndex: number
  ) => void;
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
  selectedFiles,
  handleCheckboxChange,
  handleSelectAll,
}) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set(displayedItems.filter(item => item.isFolder).map(item => item.id)));

  const toggleExpand = (itemId: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const hierarchicalDisplayedItems = useMemo(() => {
    const itemMap = new Map<
      string,
      DisplayItem & { children?: DisplayItem[]; indentationLevel?: number }
    >();
    const rootItems: (DisplayItem & {
      children?: DisplayItem[];
      indentationLevel?: number;
    })[] = [];

    const getSortValue = (item: DisplayItem, column: string): any => {
      if (item.isFolder && column !== 'displayName') return '';
      switch (column) {
        case 'displayName': return item.displayName;
        case 'checksum': return item.checksum;
        case 'documentId':
          const docId = item.documentId;
          if (docId === undefined || docId === null) return '';
          const numDocId = Number(docId);
          return isNaN(numDocId) ? docId : numDocId;
        case 'parentId': return item.parentId || '';
        case 'createdDate': return item.metadata?.createdDate ? new Date(item.metadata.createdDate).getTime() : 0;
        case 'modifiedDate': return item.metadata?.modifiedDate ? new Date(item.metadata.modifiedDate).getTime() : 0;
        case 'modifiedBy': return item.metadata?.modifiedBy || '';
        default: return '';
      }
    };

    const compareItems = (a: DisplayItem, b: DisplayItem) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // Folders always first

      const aValue = getSortValue(a, sortColumn);
      const bValue = getSortValue(b, sortColumn);

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return sortDirection === 'asc' ? String(aValue).localeCompare(String(bValue)) : String(bValue).localeCompare(String(aValue));
    };

    // Initialize map and identify root items
    displayedItems.forEach((item) => {
      itemMap.set(item.id, { ...item });
    });

    // Build hierarchy
    displayedItems.forEach((item) => {
      if (item.parentId && itemMap.has(item.parentId)) {
        const parent = itemMap.get(item.parentId);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(itemMap.get(item.id)!);
        }
      } else {
        rootItems.push(itemMap.get(item.id)!);
      }
    });

    // Flatten with indentation and handle expansion
    const flattened: (DisplayItem & {
      indentationLevel: number;
      hasChildren: boolean;
      isExpanded: boolean;
    })[] = [];

    const traverse = (
      nodes: (DisplayItem & { children?: DisplayItem[] })[],
      level: number
    ) => {
      // Sort children using the same comparison logic
      nodes.sort(compareItems);

      nodes.forEach((node) => {
        const hasChildren = !!(node.children && node.children.length > 0);
        const isExpanded = expandedItems.has(node.id);
        flattened.push({
          ...node,
          indentationLevel: level,
          hasChildren,
          isExpanded,
        });

        if (hasChildren && isExpanded) {
          traverse(node.children!, level + 1);
        }
      });
    };

    // Sort root items using the same comparison logic
    rootItems.sort(compareItems);
    traverse(rootItems, 0);

    return flattened;
  }, [displayedItems, expandedItems, sortColumn, sortDirection]);

  return displayedItems.length > 0 ? (
    <div className="overflow-auto flex-grow">
      <p className="mb-2 text-sm text-gray-500">
        Items: {displayedItems.length}
      </p>
      <table className="min-w-full divide-y divide-gray-200 shadow-sm rounded-md overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <input
                type="checkbox"
                onChange={handleSelectAll}
                checked={
                  selectedFiles.length ===
                    displayedItems.filter((item) => !item.isFolder).length &&
                  displayedItems.filter((item) => !item.isFolder).length > 0
                }
              />
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSort("displayName")}
            >
              Name
              {sortColumn === "displayName" && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSort("documentId")}
            >
              Document ID
              {sortColumn === "documentId" && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSort("parentId")}
            >
              Parent ID
              {sortColumn === "parentId" && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSort("createdDate")}
            >
              Created Date
              {sortColumn === "createdDate" && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSort("modifiedDate")}
            >
              Modified Date
              {sortColumn === "modifiedDate" && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSort("modifiedBy")}
            >
              Modified By
              {sortColumn === "modifiedBy" && (
                <span className="ml-1">
                  {sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {hierarchicalDisplayedItems.map((item, index) => (
            <tr
              key={item.id}
              className={`hover:bg-gray-100 cursor-pointer ${
                selectedItem?.id === item.id ? "bg-blue-100" : ""
              }`}
              onClick={() => setSelectedItem(item)}
              onDoubleClick={() => handleItemAction(item)}
            >
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {!item.isFolder && (
                  <input
                    type="checkbox"
                    value={item.id}
                    onChange={(e) => handleCheckboxChange(e, item, index)}
                    checked={selectedFiles.includes(item.fullPath)}
                  />
                )}
              </td>
              <td
                className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-left"
                style={{
                  paddingLeft: `${1.5 + item.indentationLevel * 1.5}rem`,
                }}
              >
                <span className="flex items-center">
                  {item.hasChildren && (
                    <span
                      className="mr-1 cursor-pointer transform transition-transform duration-200"
                      style={{
                        transform: item.isExpanded
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(item.id);
                      }}
                    >
                      ▶
                    </span>
                  )}
                  {item.isFolder ? (
                    <FolderIcon />
                  ) : (
                    getFileIcon(item.displayName)
                  )}
                  {item.displayName}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
                {!item.isFolder ? item.metadata?.documentId || "N/A" : ""}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
                {item.parentId || "N/A"}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
                {!item.isFolder ? formatDate(item.metadata?.createdDate) : ""}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
                {!item.isFolder ? formatDate(item.metadata?.modifiedDate) : ""}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
                {!item.isFolder ? item.metadata?.modifiedBy || "N/A" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : null;
};
