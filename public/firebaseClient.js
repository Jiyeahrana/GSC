const firebaseConfig = {
  apiKey: "AIzaSyBQuSr0hhXpEN-Q-_IQZi1-nFKP0nZXY0g",
  authDomain: "port-management-gsc.firebaseapp.com",
  databaseURL: "https://port-management-gsc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "port-management-gsc",
  storageBucket: "port-management-gsc.firebasestorage.app",
  messagingSenderId: "559633899238",
  appId: "1:559633899238:web:38a6218201621136812527"
};

firebase.initializeApp(firebaseConfig);
const firebaseDB = firebase.database();