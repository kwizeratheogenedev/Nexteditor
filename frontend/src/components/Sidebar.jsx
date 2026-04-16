import React from 'react';
import logo from '../assets/Logo-transparent.png';

function Sidebar({ activeTab, setActiveTab }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <img src={logo} alt="Nexera Logo" />
        <h2>NexEditor</h2>
      </div>
      <ul className="nav-menu">
        <li className={activeTab === 'media' ? 'active' : ''} onClick={() => setActiveTab('media')}>
           Montage Maker
        </li>
        <li className={activeTab === 'captions' ? 'active' : ''} onClick={() => setActiveTab('captions')}>
           Subtitle Burner
        </li>
        <li className={activeTab === 'shorts' ? 'active' : ''} onClick={() => setActiveTab('shorts')}>
           Shorts Creator
        </li>
        <li className={activeTab === 'editor' ? 'active' : ''} onClick={() => setActiveTab('editor')}>
           Advanced Editor
        </li>
      </ul>
    </nav>
  );
}

export default Sidebar;
