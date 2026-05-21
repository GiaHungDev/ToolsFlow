import sys

file_path = r"H:\laragon\www\harumi-ai\src\app\(protected)\admin\page.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
skip = False

import_added = False
columns_added = False

for i, line in enumerate(lines):
    if "import {" in line and not import_added:
        new_lines.append('import CustomTable from "@/components/shared/CTable";\n')
        new_lines.append('import { TableColumn } from "@/components/shared/CTable/interface";\n')
        new_lines.append(line)
        import_added = True
        continue
        
    if "return (" in line and not columns_added:
        # Add column definitions here
        columns_code = """
  // Table Columns
  const flowColumns: TableColumn<IFlowAccount>[] = [
    { key: "email", title: "Email liên hệ" },
    { key: "password", title: "Mật khẩu", render: (_, row) => row.password ? "••••••••" : <span className="italic text-gray-300">Không có</span> },
    { key: "twoFaCode", title: "Mã 2FA (Auth Code)", render: (_, row) => row.twoFaCode || <span className="italic text-gray-300">Không có</span> },
    { key: "cookies", title: "Trạng thái Cookies", render: (_, row) => row.cookies ? (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
        Có JSON Cookies
      </span>
    ) : (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
        Không có
      </span>
    ) },
    { key: "actions", title: "Hành động", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            resetFlowForm(row);
            setIsFlowModalOpen(true);
          }}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
          title="Sửa thông tin"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteFlow(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa tài khoản"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];

  const userColumns: TableColumn<any>[] = [
    { key: "id", title: "ID User" },
    { key: "username", title: "Tên người dùng (Username)" },
    { key: "computerId", title: "Thiết bị (Computer ID)", render: (_, row) => row.computerId || <span className="italic">Không có</span> },
    { key: "isHeadless", title: "Chạy ngầm (Headless)", render: (_, row) => (
      <div className="text-center">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={row.isHeadless}
            onChange={() => handleToggleHeadless(row.id, row.isHeadless)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
    ) },
    { key: "actions", title: "Hành động", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            resetUserForm(row);
            setIsUserModalOpen(true);
          }}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
          title="Sửa"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteUser(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];

  const basColumns: TableColumn<IBasAccount>[] = [
    { key: "username", title: "Tên đăng nhập BAS" },
    { key: "password", title: "Mật khẩu", render: (_, row) => row.password ? "••••••••" : <span className="italic text-gray-300">Không có</span> },
    { key: "staffCount", title: "Số lượng luồng (Staff)", render: (_, row) => (
      <span className="font-semibold">{row.staffCount !== null && row.staffCount !== undefined ? row.staffCount : <span className="italic font-normal text-gray-300">Không giới hạn</span>}</span>
    ) },
    { key: "flowAccount", title: "Tài khoản Flow liên kết", render: (_, row) => row.flowAccount ? (
      <div className="flex flex-col">
        <span className="text-sm font-medium text-blue-600 flex items-center gap-1">
          {row.flowAccount.email}
          <ExternalLink className="h-3 w-3" />
        </span>
        {row.flowAccount.twoFaCode && (
          <span className="text-xs text-gray-400">2FA: {row.flowAccount.twoFaCode}</span>
        )}
      </div>
    ) : (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">
        Chưa liên kết
      </span>
    ) },
    { key: "actions", title: "Hành động", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            resetBasForm(row);
            setIsBasModalOpen(true);
          }}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
          title="Sửa cấu hình"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteBas(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa cấu hình"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];\n"""
        new_lines.append(columns_code)
        new_lines.append(line)
        columns_added = True
        continue
        
    if "{/* Main content table */}" in line:
        skip = True
        new_lines.append("      {/* Main content table */}\n")
        
        table_code = """      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-8">
        <CustomTable
          data={
            activeTab === "flow" ? filteredFlows :
            activeTab === "users" ? filteredUsers :
            filteredBases
          }
          columns={
            activeTab === "flow" ? flowColumns :
            activeTab === "users" ? userColumns :
            basColumns
          }
          loading={loading}
          enableSelection={false}
          enablePagination={false}
        />
      </div>\n"""
        new_lines.append(table_code)
        continue
        
    if skip and "{/* FLOW ACCOUNT MODAL */}" in line:
        skip = False
        new_lines.append(line)
        continue
        
    if not skip:
        new_lines.append(line)

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)
