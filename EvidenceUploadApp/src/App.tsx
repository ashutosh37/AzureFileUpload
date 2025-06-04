import './App.css'

import FileUploadForm from './FileUploadForm';

function App() {
  // The min-h-screen class ensures the body takes at least the full viewport height.
  // flex flex-col makes the body a flex container stacking children vertically.
  // justify-between pushes the header to the top, footer to the bottom, and content in between.
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-between">
      {/* Header */}
      <header className="bg-blue-700 text-white p-4 shadow-md">
        <div className="container mx-auto text-center text-xl font-semibold">Evidence Upload Portal</div>
      </header>

      {/* Main Content Area - Centered */}
      <main className="flex-grow w-full max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8"> {/* Adjusted for wider content */}
        <FileUploadForm />
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-white p-4 text-center text-sm">
        © {new Date().getFullYear()} Evidence Upload App. All rights reserved.
      </footer>
    </div>
  );
}

export default App;
