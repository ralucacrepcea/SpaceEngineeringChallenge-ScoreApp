import { Link } from "react-router-dom";
import robot from "../assets/robot.png";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-950 text-white flex items-center justify-center px-4 py-12">
      <div className="max-w-6xl w-full flex flex-col md:flex-row items-center gap-10 bg-white/5 backdrop-blur-md rounded-3xl p-10 md:p-14 border border-slate-700 shadow-2xl">

        {/* LEFT - TEXT */}
        <div className="flex-1 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
            Welcome to <span className="text-indigo-400">SEC Dashboard</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 mb-8">
            Control. Visualize. Compete.<br />
            A futuristic dashboard for the UPT Space Engineering Challenge 2025.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
            <Link
              to="/login"
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-lg font-semibold shadow transition"
            >
              🚀 Login
            </Link>
            <Link
              to="/signup"
              className="px-6 py-3 bg-white text-slate-900 hover:bg-gray-200 rounded-xl text-lg font-semibold shadow transition"
            >
              🧑‍🚀 Sign Up
            </Link>
          </div>
        </div>

        {/* RIGHT - IMAGE */}
        <div className="flex-1 flex justify-center">
          <img
            src={robot}
            alt="Robot mascot"
            className="w-[240px] md:w-[280px] lg:w-[320px] drop-shadow-xl"
          />
        </div>
      </div>
    </div>
  );
}
