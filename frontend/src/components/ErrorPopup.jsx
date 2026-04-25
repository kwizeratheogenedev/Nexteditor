function ErrorPopup({ errorText, setErrorText }) {
  if (!errorText) {
    return null;
  }

  return (
    <div className="error-toast">
      <span>{errorText}</span>
      <button type="button" className="error-toast-close" onClick={() => setErrorText(null)}>×</button>
    </div>
  );
}

export default ErrorPopup;
