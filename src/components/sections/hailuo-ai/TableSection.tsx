"use client";

import CustomTable from "@/components/shared/CTable";
import { TableColumn } from "@/components/shared/CTable/interface";
import { Button } from "@/components/ui/button";
import React, { useState } from "react";

// Kiểu dữ liệu cho mỗi hàng
interface Employee {
  id: number;
  name: string;
  email: string;
  role: "Admin" | "User" | "Manager";
  department: string;
  salary: string;
  status: "Active" | "Inactive";
  joinDate: string;
  phone: string;
  [key: string]: string | number;
}

const AppTable: React.FC = () => {
  const generateSampleData = (count: number): Employee[] => {
    const roles: Employee["role"][] = ["Admin", "User", "Manager"];
    const departments = [
      "IT",
      "Marketing",
      "Sales",
      "HR",
      "Finance",
      "Operations",
    ];
    const statuses: Employee["status"][] = ["Active", "Inactive"];

    const firstNames = [
      "John",
      "Jane",
      "Michael",
      "Emily",
      "David",
      "Sarah",
      "Robert",
      "Laura",
      "Daniel",
      "Olivia",
      "James",
      "Sophia",
    ];
    const lastNames = [
      "Smith",
      "Johnson",
      "Brown",
      "Williams",
      "Jones",
      "Miller",
      "Davis",
      "Garcia",
      "Rodriguez",
      "Martinez",
      "Hernandez",
      "Lopez",
    ];

    const getRandomItem = <T,>(arr: T[]): T =>
      arr[Math.floor(Math.random() * arr.length)];

    const getRandomDate = (start: Date, end: Date) =>
      new Date(
        start.getTime() + Math.random() * (end.getTime() - start.getTime())
      )
        .toISOString()
        .split("T")[0];

    return Array.from({ length: count }, (_, i): Employee => {
      const firstName = getRandomItem(firstNames);
      const lastName = getRandomItem(lastNames);
      const fullName = `${firstName} ${lastName}`;
      const email = `${firstName}.${lastName}${Math.floor(
        Math.random() * 1000
      )}@example.com`.toLowerCase();

      return {
        id: i + 1,
        name: fullName,
        email,
        role: getRandomItem(roles),
        department: getRandomItem(departments),
        salary: `$${(
          50000 + Math.floor(Math.random() * 50000)
        ).toLocaleString()}`,
        status: getRandomItem(statuses),
        joinDate: getRandomDate(new Date(2020, 0, 1), new Date()),
        phone: `+1-234-567-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, "0")}`,
      };
    });
  };

  const sampleData = generateSampleData(10);

  const [tableData, setTableData] = useState<Employee[]>(sampleData);
  const [pagination, setPagination] = useState({
    total: 50,
    page: 1,
    limit: 10,
    totalPages: 5,
  });
  const [loading, setLoading] = useState(false);

  const handlePaginationChange = async (page: number, limit: number) => {
    setLoading(true);
    try {
      const sampleData = generateSampleData(10);

      setPagination({
        total: 50,
        page: page,
        limit: limit,
        totalPages: 5,
      });
      setTableData(sampleData);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const columns: TableColumn<Employee>[] = [
    { key: "id", title: "ID", width: 60, className: "font-medium" },
    { key: "name", title: "Name", width: 150, className: "font-medium" },
    { key: "email", title: "Email", width: 200 },
    { key: "department", title: "Department", width: 120 },
    {
      key: "salary",
      title: "Salary",
      width: 100,
      className: "font-medium",
    },
    { key: "joinDate", title: "Join Date", width: 120 },
    { key: "phone", title: "Phone", width: 150 },
  ];

  const fixedRightColumns: TableColumn<Employee>[] = [
    {
      key: "role",
      title: "Role",
      width: 100,
      render: (value) => {
        // Type assertion vì value là unknown
        const role = value as Employee["role"];
        return (
          <span
            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
              role === "Admin"
                ? "bg-purple-100 text-purple-800"
                : role === "Manager"
                ? "bg-blue-100 text-blue-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {role}
          </span>
        );
      },
    },
    {
      key: "status",
      title: "Status",
      width: 100,
      render: (value) => {
        const status = value as Employee["status"];
        return (
          <span
            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
              status === "Active"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {status}
          </span>
        );
      },
    },
    {
      key: "actions",
      title: "Actions",
      width: 120,
      actions: [
        {
          key: "edit",
          label: "Edit",
          className: "text-blue-600 hover:text-blue-800",
        },
        {
          key: "delete",
          label: "Delete",
          className: "text-red-600 hover:text-red-800",
        },
      ],
    },
  ];

  const handleSelectionChange = (selectedIds: (string | number)[]): void => {
    console.log("Selected rows:", selectedIds);
  };

  const handleRowAction = (action: string, row: Employee): void => {
    console.log(`Action: ${action}`, row);
  };

  return (
    <>
      <div className="flex justify-end space-x-2 rounded-lg p-2 bg-gray-50 mb-2">
        <Button variant="outline" className="">
          Tải tất cả
        </Button>
        <Button className="bg-blue-500 hover:bg-blue-400">Tìm kiếm</Button>
      </div>
      <div className="rounded-lg p-2 bg-gray-50">
        <CustomTable<Employee>
          data={tableData}
          columns={columns}
          fixedRightColumns={fixedRightColumns}
          title="Danh sách video Hailou AI"
          maxHeight="max-h-[calc(100vh-250px)] sm:max-h-[calc(100vh-300px)] lg:max-h-[calc(100vh-350px)]"
          enableSelection={true}
          enablePagination={true}
          pageSizeOptions={[10, 20, 30, 50]}
          onSelectionChange={handleSelectionChange}
          onRowAction={handleRowAction}
          pagination={pagination}
          loading={loading}
          onPaginationChange={handlePaginationChange}
          zebra={true}
        />
      </div>
    </>
  );
};

export default AppTable;
