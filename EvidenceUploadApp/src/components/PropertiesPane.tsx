import { useState, useEffect } from 'react';
import type { DisplayItem } from '../interfaces';
import { formatDate } from '../utils/utilities';
import * as apiService from '../services/apiService';

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
  onRefresh,
  accessToken,
  getAuthHeaders,
}) => {
  if (!item) {
    return (
      <div className="w-96 flex-shrink-0 bg-white p-6 rounded-xl shadow-2xl flex items-center justify-center h-full overflow-auto">
        <p className="text-gray-500 text-center">Select an item to view its properties.</p>
      </div>
    );
  }

  const auditKeys = ['createdDate', 'createdBy', 'modifiedDate', 'modifiedBy'];
  const [newMetadataKey, setNewMetadataKey] = useState('');
  const [newMetadataValue, setNewMetadataValue] = useState('');
  const [editMetadata, setEditMetadata] = useState<Record<string, string>>(() => item.metadata || {});
  const [isSavingMetadata, setIsSavingMetadata] = useState<boolean>(false);
  const [metadataError, setMetadataError] = useState<string>('');

  const auditMetadata = Object.fromEntries(
    Object.entries(editMetadata).filter(([key]) => auditKeys.includes(key))
  );
  const customMetadata = Object.fromEntries(
    Object.entries(editMetadata).filter(([key]) => !auditKeys.includes(key))
  );

  // Reset editMetadata when the selected item changes
  useEffect(() => {
    setEditMetadata(item.metadata || {});
    setNewMetadataKey('');
    setNewMetadataValue('');
    setMetadataError('');
  }, [item]);

  const handleAddMetadata = () => {
    setMetadataError('');
    if (!newMetadataKey.trim()) {
      setMetadataError('Metadata key cannot be empty.');
      return;
    }
    if (editMetadata.hasOwnProperty(newMetadataKey.trim())) {
      setMetadataError(`Metadata key "${newMetadataKey.trim()}" already exists. Please use a different key or edit the existing one.`);
      return;
    }
    setEditMetadata(prev => ({ ...prev, [newMetadataKey.trim().toLowerCase()]: newMetadataValue.trim() }));
    setNewMetadataKey('');
    setNewMetadataValue('');
  };

  const handleSaveMetadata = async () => {
    if (item.isFolder) return;
    setIsSavingMetadata(true);
    setMetadataError('');
    if (!accessToken) {
      setMetadataError("Authentication token is not yet available. Please wait a moment and try again.");
      setIsSavingMetadata(false);
      return;
    }
    try {
      await apiService.updateMetadata(containerName, item.fullPath, editMetadata, getAuthHeaders);
      onRefresh();
    } catch (error) {
      console.error("Error saving metadata:", error);
      setMetadataError(error instanceof Error ? `Error saving metadata: ${error.message}` : 'An unknown error occurred while saving metadata.');
    } finally {
      setIsSavingMetadata(false);
    }
  };

  return (
    <div className="w-96 flex-shrink-0 bg-white p-6 rounded-xl shadow-2xl overflow-auto h-full">
      <h3 className="text-xl font-semibold mb-4 text-gray-700 border-b pb-2">Properties</h3>
      <div className="space-y-3 text-sm text-left">
        <div>
          <label className="font-bold text-gray-600">Name:</label>
          <p className="text-gray-800 break-words">{item.displayName}</p>
        </div>
        {!item.isFolder && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="space-y-2 mb-4">
              {auditKeys.map(key => auditMetadata[key] && (
                <div key={key}>
                  <label className="font-bold text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}:</label>
                  <p className="text-gray-800 break-words">{key.toLowerCase().includes('date') ? formatDate(auditMetadata[key]) : auditMetadata[key]}</p>
                </div>
              ))}
            </div>

            <h4 className="font-semibold text-gray-700 mb-2 border-t pt-4">Custom Properties</h4>
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

            <div className="mt-4 p-3 border border-gray-200 rounded-md bg-gray-50">
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
            </div>

            <button
              onClick={handleSaveMetadata}
              disabled={isSavingMetadata || item.isFolder}
              className={`mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md ${isSavingMetadata || item.isFolder ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSavingMetadata ? 'Saving...' : 'Save All Metadata Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};