// `action` ({ forText, label, run }) adds one button, shown only while the
// message it was made for is the one on screen.
function ErrorPopup({ errorText, setErrorText, action }) {
  if (!errorText) {
    return null;
  }
  const showAction = action && action.forText === errorText;

  return (
    <div className="error-toast">
      <span>{errorText}</span>
      {showAction && (
        <button type="button" className="error-toast-action" onClick={() => { setErrorText(null); action.run(); }}>{action.label}</button>
      )}
      <button type="button" className="error-toast-close" onClick={() => setErrorText(null)}>×</button>
    </div>
  );
}

export default ErrorPopup;
