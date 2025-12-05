import { cn } from "@sglara/cn";
import { participation_colors } from "@/utils/colors";

interface Props {
    title: string;
    author: string;
    participation_type: "a" | "b" | "c" | "d" | "e";
    content: string;
}

const Post = ({ title, author, participation_type, content }: Props) => {
    return (
        <div className="border p-2 rounded w-full shadow-md hover:shadow-2xl transition-shadow hover:cursor-pointer">
            <h3 className="text-lg font-bold">{title}</h3>
            <div className="flex flex-row items-start justify-start gap-4">
                <p className="text-gray-500">{author}</p>
                <p
                    className={cn(
                        participation_colors[participation_type],
                        "w-fit",
                        "px-1",
                        "rounded"
                    )}
                >
                    Participation Special {participation_type.toUpperCase()}
                </p>
            </div>
            <p>{content}</p>
        </div>
    );
};

export default Post;
