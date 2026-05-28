import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  placeholder?: string;
  delay?: number;
  onSearch: (value: string) => void;
  initialValue?: string;
  className?: string;
  inputClassName?: string;
}

export function SearchBar({
  placeholder = "Search...",
  delay = 350,
  onSearch,
  initialValue = "",
  className,
  inputClassName,
}: SearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const debounced = useDebounce(value, delay);

  useEffect(() => {
    onSearch(debounced);
  }, [debounced, onSearch]);

  return (
    <div className={cn("relative w-full", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={cn("pl-9", inputClassName)}
        aria-label="Search"
      />
    </div>
  );
}
