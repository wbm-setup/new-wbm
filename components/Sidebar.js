import Link from 'next/link';

export default function Sidebar({ isOpen, toggleSidebar }) {
  return (
    <div className={`bg-gray-700 text-white fixed top-0 left-0 w-64 h-full transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out z-50`}>
      <button onClick={toggleSidebar} className="text-white p-4">
        Close
      </button>
      <ul className="mt-4">
        <li className="p-4 border-b border-gray-600">
          <Link href="/" onClick={toggleSidebar}>Home</Link>
        </li>
        <li className="p-4 border-b border-gray-600">
          <Link href="/messages" onClick={toggleSidebar}>Messages</Link>
        </li>
        <li className="p-4 border-b border-gray-600">
          <Link href="/waste-bins" onClick={toggleSidebar}>Bins</Link>
        </li>
        <li className="p-4 border-b border-gray-600">
          <Link href="/routes" onClick={toggleSidebar}>Routes</Link>
        </li>
      </ul>
    </div>
  );
}
