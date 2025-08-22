import { User } from "lucide-react";
import { NavigationProps } from "./interface";

const Navigation: React.FC<NavigationProps> = ({ user }) => (
  <nav className="fixed w-full top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-700">
    <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
          H
        </div>
        <span className="text-xl font-bold">Harumi AI</span>
      </div>
      {user && (
        <div className="flex items-center space-x-2 p-2 rounded-lg group">
          <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
            <User className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-medium">{user.username}</span>
        </div>
      )}
    </div>
  </nav>
);

export default Navigation;
