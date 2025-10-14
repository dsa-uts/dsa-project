import { Link } from "react-router";

const GradingMenu: React.FC = () => {
  return (
    <div className="container mx-auto px-8 py-6">
      <h1 className="text-3xl font-bold mb-4">Grading Menu</h1>

      {/* List for pages Manager or Admin can visit. */}
      <ul className="list-disc list-inside space-y-2">
        <li className="text-blue-600 text-xl hover:underline">
          <Link to="/grading/upload/batch" className="ml-4">Grading Request (一括提出)</Link>
        </li>
        <li className="text-blue-600 text-xl hover:underline">
          <Link to="/grading/upload/single" className="ml-4">Grading Request (個別提出)</Link>
        </li>
        <li className="text-blue-600 text-xl hover:underline">
          <Link to="/grading/results" className="ml-4">Grading Results (採点結果一覧)</Link>
        </li>
      </ul>
    </div>
  )
}

export default GradingMenu;