import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  // alege una dintre opțiuni:
  enableMultiTabIndexedDbPersistence, // recomandat dacă aplicația poate fi deschisă în mai multe taburi(DEPRECATED)
  // enableIndexedDbPersistence,      // alternativă pentru single-tab
} from "firebase/firestore";
import { getDatabase } from "firebase/database"; // dacă folosești RTDB

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCIMWfYFDtmQ0VcCd9Gcb4eo4lukXZYodI",
  authDomain: "spaceengineeringchallenge.firebaseapp.com",
  projectId: "spaceengineeringchallenge",
  storageBucket: "spaceengineeringchallenge.firebasestorage.app",
  messagingSenderId: "45731512584",
  appId: "1:45731512584:web:0801466b1972c457122cbd",
  measurementId: "G-MQFSL13HW7",

  databaseURL: "https://spaceengineeringchallenge-default-rtdb.europe-west1.firebasedatabase.app",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Creează instanțele
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app); // opțional, doar dacă îl folosești

// Activează persistența IMEDIAT după crearea lui `db` (în acest fișier!),
//    înainte ca oricare alt modul să înceapă să folosească Firestore.
if (typeof window !== "undefined") {
  enableMultiTabIndexedDbPersistence(db).catch((err) => {
    // 'failed-precondition' -> mai multe taburi vechi fără multi-tab / conflict
    // 'unimplemented'      -> browser nu suportă IndexedDB
    if (err?.code !== "failed-precondition" && err?.code !== "unimplemented") {
      console.error("Firestore persistence error:", err);
    }
  });

  // single-tab 
  /*
  enableIndexedDbPersistence(db).catch((err) => {
    if (err?.code !== "failed-precondition" && err?.code !== "unimplemented") {
      console.error("Firestore persistence error:", err);
    }
  });
  */
}
