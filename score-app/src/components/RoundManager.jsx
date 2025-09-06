import React from "react";

export default function RoundManager({
  rounds,
  roundConfigs,
  newRound,
  setNewRound,
  handleAddRound,
  handleDeleteRound,
  handleChangeTotalCheckpoints,
}) {
  return (
    <div className="mt-10 w-full">
      <h3 className="text-lg font-bold text-white mb-4 text-center">
        📍 Manage Checkpoints per Round
      </h3>

      <div className="space-y-4 flex flex-col items-center">
        {rounds.map((round) => (
          <div
            key={round}
            className="w-full max-w-lg bg-slate-800 px-4 py-3 rounded-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-slate-700"
          >
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
              <span className="text-white font-medium">🔁 {round}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={roundConfigs[round] || 5}
                  onChange={(e) =>
                    handleChangeTotalCheckpoints(round, e.target.value)
                  }
                  className="bg-slate-700 text-white px-2 py-1 border border-slate-600 rounded w-24 text-center"
                />
                <span className="text-slate-400 text-sm">checkpoints</span>
              </div>
            </div>

            <button
              onClick={() => handleDeleteRound(round)}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-1 rounded text-sm w-full sm:w-auto"
            >
              ❌ Delete
            </button>
          </div>
        ))}

        {/* ➕ Add New Round */}
        <div className="mt-6 w-full max-w-lg">
            <div className="flex flex-col sm:flex-row gap-3">
                <input
                type="text"
                placeholder="New round name"
                value={newRound}
                onChange={(e) => setNewRound(e.target.value)}
                className="bg-slate-700 px-4 py-2 rounded-md border border-slate-600 text-white w-full"
                />
                <button
                onClick={handleAddRound}
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-md font-semibold text-white sm:w-auto w-full"
                >
                ➕Add
                </button>
            </div>
        </div>

      </div>
    </div>
  );
}
