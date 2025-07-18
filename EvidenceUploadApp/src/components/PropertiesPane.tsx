import { useState, useEffect } from 'react';
import type { DisplayItem } from '../interfaces';
import { formatDate } from '../utils/utilities';
//import * as apiService from '../services/apiService';
import { FilePreview } from './FilePreview';

interface PropertiesPaneProps {
  item: DisplayItem | null;
  containerName: string;
  onRefresh: () => void;
  accessToken: string | null;
  getAuthHeaders: (isFormData?: boolean) => HeadersInit;
}

export const PropertiesPane: React.FC<PropertiesPaneProps> = ({
  item,
  containerName,
  //onRefresh,
  accessToken,
  getAuthHeaders,
}) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'preview'>('properties');
  //const [newMetadataKey, setNewMetadataKey] = useState('');
  //const [newMetadataValue, setNewMetadataValue] = useState('');
  const [editMetadata, setEditMetadata] = useState<Record<string, string>>({});
  //const [isSavingMetadata, setIsSavingMetadata] = useState<boolean>(false);
  //const [metadataError, setMetadataError] = useState<string>('');

  // Reset state when the selected item changes. This now runs on every render
  // and handles the case where `item` is null.
  useEffect(() => {
    if (item) {
      setEditMetadata(item.metadata || {});
    } else {
      setEditMetadata({}); // Clear metadata when no item is selected
    }
    //setNewMetadataKey('');
    //setNewMetadataValue('');
    //setMetadataError('');
    // When a folder is selected, or no item is selected,
    // we must be on the 'properties' tab. Otherwise, we don't change the tab,
    // preserving the user's choice when switching between files.
    if (!item || item.isFolder) {
      setActiveTab('properties');
    }
  }, [item]);

  if (!item) {
    return (
      <div className="w-[32rem] flex-shrink-0 bg-white flex items-center justify-center h-full overflow-auto">
        <p className="text-gray-500 text-center">Select an item to view its properties.</p>
      </div>
    );
  }

  const auditKeys = ['createdDate', 'createdBy', 'modifiedDate', 'modifiedBy'];
  const auditMetadata = Object.fromEntries(
    Object.entries(editMetadata).filter(([key]) => auditKeys.includes(key))
  );
  const customMetadata = Object.fromEntries(
    Object.entries(editMetadata).filter(([key]) => !auditKeys.includes(key))
  );

  // const handleAddMetadata = () => {
  //   setMetadataError('');
  //   if (!newMetadataKey.trim()) {
  //     setMetadataError('Metadata key cannot be empty.');
  //     return;
  //   }
  //   if (editMetadata.hasOwnProperty(newMetadataKey.trim())) {
  //     setMetadataError(`Metadata key "${newMetadataKey.trim()}" already exists. Please use a different key or edit the existing one.`);
  //     return;
  //   }
  //   setEditMetadata(prev => ({ ...prev, [newMetadataKey.trim().toLowerCase()]: newMetadataValue.trim() }));
  //   setNewMetadataKey('');
  //   setNewMetadataValue('');
  // };

  // const handleSaveMetadata = async () => {
  //   if (item.isFolder) return;
  //   setIsSavingMetadata(true);
  //   setMetadataError('');
  //   if (!accessToken) {
  //     setMetadataError("Authentication token is not yet available. Please wait a moment and try again.");
  //     setIsSavingMetadata(false);
  //     return;
  //   }
  //   try {
  //     await apiService.updateMetadata(containerName, item.fullPath, editMetadata, getAuthHeaders);
  //     onRefresh();
  //   } catch (error) {
  //     console.error("Error saving metadata:", error);
  //     setMetadataError(error instanceof Error ? `Error saving metadata: ${error.message}` : 'An unknown error occurred while saving metadata.');
  //   } finally {
  //     setIsSavingMetadata(false);
  //   }
  // };

  return (
    <div className="w-[32rem] flex-shrink-0 bg-gray-50 flex flex-col h-full overflow-hidden">
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('properties')}
          className={`flex-1 p-3 text-sm font-medium focus:outline-none ${
            activeTab === 'properties'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          Properties
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          disabled={item.isFolder}
          className={`flex-1 p-3 text-sm font-medium focus:outline-none ${
            activeTab === 'preview'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:bg-gray-100'
          } ${item.isFolder ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          Preview
        </button>
      </div>

      <div className="flex-grow overflow-auto">
        {activeTab === 'properties' && (
          <div className="p-6">
            <div className="space-y-3 text-sm text-left">
              <div>
                <label className="font-bold text-gray-600">Name:</label>
                <p className="text-gray-800">{item.displayName}</p>
              </div>
              {!item.isFolder && (
                <div className="mt-2">
                  <div className="space-y-2 mb-4">
                    {auditKeys.map(key => auditMetadata[key] && (
                      <div key={key}>
                        <label className="font-bold text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}:</label>
                        <p className="text-gray-800 break-words">{key.toLowerCase().includes('date') ? formatDate(auditMetadata[key]) : auditMetadata[key]}</p>
                      </div>
                    ))}
                  </div>

                  {Object.keys(customMetadata).length === 0 && <p className="text-gray-500 text-sm">No custom properties.</p>}
                  <div className="space-y-2">
                    {Object.entries(customMetadata).map(([key, value]) => (
                      <div key={key} className="font-bold text-gray-600 break-all">{key}:
                        <div className="rounded-md flex flex-wrap">
                          <div className="flex-grow min-w-0">
                            <p className="font-normal text-gray-800 break-words">{value}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* <div className="mt-4 p-3 border border-gray-200 rounded-md bg-gray-50">
                    <h4 className="font-semibold text-gray-700 mb-2">Add New Property</h4>
                  <div className="mb-2">
                      <input
                        type="text"
                        placeholder="Key"
                        value={newMetadataKey}
                        onChange={(e) => setNewMetadataKey(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md text-gray-800"
                      />
                    </div>
                    <div className="mb-2">
                      <input
                        type="text"
                        placeholder="Value"
                        value={newMetadataValue}
                        onChange={(e) => setNewMetadataValue(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md text-gray-800"
                      />
                    </div>
                    {metadataError && <p className="text-red-500 text-xs mb-2">{metadataError}</p>}
                    <button
                      onClick={handleAddMetadata}
                      className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-md text-sm"
                    >
                      Add Property
                    </button>
                  </div> */}

                  {/* <button
                    onClick={handleSaveMetadata}
                    disabled={isSavingMetadata || item.isFolder}
                    className={`mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md ${isSavingMetadata || item.isFolder ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isSavingMetadata ? 'Saving...' : 'Save All Metadata Changes'}
                  </button> */}
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'preview' && (
          <FilePreview
            item={item}
            containerName={containerName}
            accessToken={accessToken}
            getAuthHeaders={getAuthHeaders}
          />
        )}
      </div>
    </div>
  );
};