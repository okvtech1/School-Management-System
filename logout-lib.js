/*******************************************************************
 * SHARED LOGOUT — include on any staff page, then add a button with
 * onclick="smsLogout()". Clears the local session and returns to login.
 *******************************************************************/
function smsLogout(){
  localStorage.removeItem('sms_session');
  localStorage.removeItem('sms_offline_cred');
  window.top.location.href = 'login.html';
}
