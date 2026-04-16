import React from 'react';

function ErrorPopup({ errorText, setErrorText }) {
  if (!errorText) return null;

  return (
    <div className="error-popup">
      <span>{errorText}</span>
      <button type="button" className="close-popup" onClick={() => setErrorText(null)}>×</button>
    </div>
  );
}

export default ErrorPopup;
