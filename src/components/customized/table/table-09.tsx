"use client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  GripHorizontal
} from "lucide-react";
import * as React from "react";

// Sample products data - thay thế bằng dữ liệu thực của bạn
const products = [
  {
    id: "P001",
    name: "Wireless Bluetooth Headphones",
    category: "Electronics",
    price: 99.99,
    rating: 4.5,
    stockQuantity: 25,
    supplier: "TechCorp",
    dateAdded: "2024-01-15",
  },
  {
    id: "P002",
    name: "Gaming Mouse",
    category: "Electronics",
    price: 49.99,
    rating: 4.2,
    stockQuantity: 50,
    supplier: "GameTech",
    dateAdded: "2024-01-20",
  },
  {
    id: "P003",
    name: "Coffee Maker",
    category: "Appliances",
    price: 129.99,
    rating: 4.8,
    stockQuantity: 15,
    supplier: "HomeGoods",
    dateAdded: "2024-02-01",
  },
  {
    id: "P004",
    name: "Office Chair",
    category: "Furniture",
    price: 299.99,
    rating: 4.3,
    stockQuantity: 8,
    supplier: "FurniturePlus",
    dateAdded: "2024-02-05",
  },
  {
    id: "P005",
    name: "Smartphone Case",
    category: "Electronics",
    price: 19.99,
    rating: 4.1,
    stockQuantity: 100,
    supplier: "TechCorp",
    dateAdded: "2024-02-10",
  },
  {
    id: "P001",
    name: "Wireless Bluetooth Headphones",
    category: "Electronics",
    price: 99.99,
    rating: 4.5,
    stockQuantity: 25,
    supplier: "TechCorp",
    dateAdded: "2024-01-15",
  },
  {
    id: "P002",
    name: "Gaming Mouse",
    category: "Electronics",
    price: 49.99,
    rating: 4.2,
    stockQuantity: 50,
    supplier: "GameTech",
    dateAdded: "2024-01-20",
  },
  {
    id: "P003",
    name: "Coffee Maker",
    category: "Appliances",
    price: 129.99,
    rating: 4.8,
    stockQuantity: 15,
    supplier: "HomeGoods",
    dateAdded: "2024-02-01",
  },
  {
    id: "P004",
    name: "Office Chair",
    category: "Furniture",
    price: 299.99,
    rating: 4.3,
    stockQuantity: 8,
    supplier: "FurniturePlus",
    dateAdded: "2024-02-05",
  },
  {
    id: "P005",
    name: "Smartphone Case",
    category: "Electronics",
    price: 19.99,
    rating: 4.1,
    stockQuantity: 100,
    supplier: "TechCorp",
    dateAdded: "2024-02-10",
  },
  {
    id: "P001",
    name: "Wireless Bluetooth Headphones",
    category: "Electronics",
    price: 99.99,
    rating: 4.5,
    stockQuantity: 25,
    supplier: "TechCorp",
    dateAdded: "2024-01-15",
  },
  {
    id: "P002",
    name: "Gaming Mouse",
    category: "Electronics",
    price: 49.99,
    rating: 4.2,
    stockQuantity: 50,
    supplier: "GameTech",
    dateAdded: "2024-01-20",
  },
  {
    id: "P003",
    name: "Coffee Maker",
    category: "Appliances",
    price: 129.99,
    rating: 4.8,
    stockQuantity: 15,
    supplier: "HomeGoods",
    dateAdded: "2024-02-01",
  },
  {
    id: "P004",
    name: "Office Chair",
    category: "Furniture",
    price: 299.99,
    rating: 4.3,
    stockQuantity: 8,
    supplier: "FurniturePlus",
    dateAdded: "2024-02-05",
  },
  {
    id: "P005",
    name: "Smartphone Case",
    category: "Electronics",
    price: 19.99,
    rating: 4.1,
    stockQuantity: 100,
    supplier: "TechCorp",
    dateAdded: "2024-02-10",
  },
  {
    id: "P001",
    name: "Wireless Bluetooth Headphones",
    category: "Electronics",
    price: 99.99,
    rating: 4.5,
    stockQuantity: 25,
    supplier: "TechCorp",
    dateAdded: "2024-01-15",
  },
  {
    id: "P002",
    name: "Gaming Mouse",
    category: "Electronics",
    price: 49.99,
    rating: 4.2,
    stockQuantity: 50,
    supplier: "GameTech",
    dateAdded: "2024-01-20",
  },
  {
    id: "P003",
    name: "Coffee Maker",
    category: "Appliances",
    price: 129.99,
    rating: 4.8,
    stockQuantity: 15,
    supplier: "HomeGoods",
    dateAdded: "2024-02-01",
  },
  {
    id: "P004",
    name: "Office Chair",
    category: "Furniture",
    price: 299.99,
    rating: 4.3,
    stockQuantity: 8,
    supplier: "FurniturePlus",
    dateAdded: "2024-02-05",
  },
  {
    id: "P005",
    name: "Smartphone Case",
    category: "Electronics",
    price: 19.99,
    rating: 4.1,
    stockQuantity: 100,
    supplier: "TechCorp",
    dateAdded: "2024-02-10",
  },
  {
    id: "P001",
    name: "Wireless Bluetooth Headphones",
    category: "Electronics",
    price: 99.99,
    rating: 4.5,
    stockQuantity: 25,
    supplier: "TechCorp",
    dateAdded: "2024-01-15",
  },
  {
    id: "P002",
    name: "Gaming Mouse",
    category: "Electronics",
    price: 49.99,
    rating: 4.2,
    stockQuantity: 50,
    supplier: "GameTech",
    dateAdded: "2024-01-20",
  },
  {
    id: "P003",
    name: "Coffee Maker",
    category: "Appliances",
    price: 129.99,
    rating: 4.8,
    stockQuantity: 15,
    supplier: "HomeGoods",
    dateAdded: "2024-02-01",
  },
  {
    id: "P004",
    name: "Office Chair",
    category: "Furniture",
    price: 299.99,
    rating: 4.3,
    stockQuantity: 8,
    supplier: "FurniturePlus",
    dateAdded: "2024-02-05",
  },
  {
    id: "P005",
    name: "Smartphone Case",
    category: "Electronics",
    price: 19.99,
    rating: 4.1,
    stockQuantity: 100,
    supplier: "TechCorp",
    dateAdded: "2024-02-10",
  },
];

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  rating: number;
  stockQuantity: number;
  supplier: string;
  dateAdded: string;
};

export const columns: ColumnDef<Product>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: "ID",
    cell: ({ row }) => <div className="font-mono">{row.getValue("id")}</div>,
  },
  {
    accessorKey: "name",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Product Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      );
    },
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => <div>{row.getValue("category")}</div>,
  },
  {
    accessorKey: "price",
    header: () => <div className="text-right">Price (USD)</div>,
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("price"));
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);
      return <div className="text-right font-medium">{formatted}</div>;
    },
  },
  {
    accessorKey: "rating",
    header: "Rating",
    cell: ({ row }) => {
      const rating = parseFloat(row.getValue("rating"));
      return <div>{rating.toFixed(1)}/5</div>;
    },
  },
  {
    accessorKey: "stockQuantity",
    header: "Stock Quantity",
    cell: ({ row }) => {
      const stock = parseInt(row.getValue("stockQuantity"));
      return (
        <div className={stock < 20 ? "text-red-600 font-medium" : ""}>
          {stock}
        </div>
      );
    },
  },
  {
    accessorKey: "supplier",
    header: "Supplier",
    cell: ({ row }) => <div>{row.getValue("supplier")}</div>,
  },
  {
    accessorKey: "dateAdded",
    header: "Date Added",
    cell: ({ row }) => <div>{row.getValue("dateAdded")}</div>,
  },
  {
    id: "actions",
    header: "action",
    enableHiding: false,
    cell: ({ row }) => {
      const product = row.original;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <GripHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(product.id)}
            >
              Copy product ID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>View details</DropdownMenuItem>
            <DropdownMenuItem>Edit product</DropdownMenuItem>
            <DropdownMenuItem>Delete product</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

export default function StickyHeaderTableDemo() {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  const table = useReactTable({
    data: products,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  return (
    <div className="w-full space-y-4">
      {/* Table with sticky header */}
      <div className="grid w-full [&>div]:max-h-[calc(100vh-300px)] [&>div]:border [&>div]:rounded [&>div]:overflow-auto">
        <div>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="[&>*]:whitespace-nowrap sticky top-0 bg-background after:content-[''] after:inset-x-0 after:h-px after:bg-border after:absolute after:bottom-0"
                >
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="pl-4">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="overflow-hidden">
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="odd:bg-muted/50 [&>*]:whitespace-nowrap"
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="pl-4">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap">Rows per page:</Label>
            <Select
            // value={rowsPerPage.toString()}
            // onValueChange={(rowsPerPage) => setRowsPerPage(+rowsPerPage)}
            >
              <SelectTrigger className="w-[65px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            {/* <span className="text-sm text-muted-foreground whitespace-nowrap">
              {(page - 1) * rowsPerPage + 1}-{page * rowsPerPage} of{" "}
              {TOTAL_ITEMS}
            </span> */}
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <Button
                    aria-label="Go to previous page"
                    size="icon"
                    variant="ghost"
                    // disabled={page === 1}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    aria-label="Go to next page"
                    size="icon"
                    variant="ghost"
                    // disabled={page * rowsPerPage >= TOTAL_ITEMS}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      </div>
    </div>
  );
}
