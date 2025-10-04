import React, { useState } from "react"

const resultIDtoString = {
  0: "AC",
  1: "WA",
  2: "TLE",
  3: "MLE",
  4: "RE",
  5: "CE",
  6: "OLE",
  7: "IE",
  8: "FN",
  9: "Judging",
  10: "WJ",
}

const resultIDtoExplanation = {
  0: "Accepted",
  1: "Wrong Answer",
  2: "Time Limit Exceeded",
  3: "Memory Limit Exceeded",
  4: "Runtime Error",
  5: "Compilation Error",
  6: "Output Limit Exceeded",
  7: "Internal Error",
  8: "File Not Found",
  9: "Judging",
  10: "Waiting for Judging",
}

// Result Badge Component with Tooltip
const ResultBadge: React.FC<{ resultID: number }> = ({ resultID }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const resultText = resultIDtoString[resultID as keyof typeof resultIDtoString] || "Unkknown";
  const explanation = resultIDtoExplanation[resultID as keyof typeof resultIDtoExplanation] || "Unknown Result";

  // AC: Green, other: Orange
  const isGreen = resultID === 0;
  const isGray = resultID === 9 || resultID === 10;

  const bgColor = isGreen ? "bg-green-500" : isGray ? "bg-gray-500" : "bg-orange-500";
  const hoverBgColor = isGreen ? "hover:bg-green-600" : isGray ? "hover:bg-gray-600" : "hover:bg-orange-600";

  return (
    <div className="relative inline-block">
      <div
        className={`${bgColor} ${hoverBgColor} flex items-center text-white px-2 py-1 rounded cursor-pointer font-semibold text-sm transition-colors duration-200`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {resultText}
        {(resultID === 9 || resultID === 10) && (
          <div className="pl-1 animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full"></div>
        )}
      </div>

      {showTooltip && (
        <>
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-10">
            <div className="bg-gray-800 text-white text-xs px-3 py-2 rounded whitespace-nowrap">
              <div className="text-gray-300">
                {explanation}
              </div>
            </div>
            {/* Arrow pointing down */}
            <div className="absolute left-1/2 transform -translate-x-1/2" style={{ bottom: '-6px' }}>
              <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-800"></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ResultBadge;