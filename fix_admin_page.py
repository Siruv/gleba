with open("src/app/admin/page.tsx", "r") as f:
    content = f.read()

# Fix imports
# Replace the conflicted import line
import_old = "<<<<<<< HEAD\nimport { Users, UserPlus, Shield, Activity, Database, MessageSquare, Bug, TrendingUp, Flag, Bell, Bot } from \"lucide-react\"\n=======\nimport { Users, UserPlus, Shield, Activity, Database, MessageSquare, Bug, TrendingUp, Flag, ShieldAlert } from \"lucide-react\"\n>>>>>>> origin/main"
import_new = "import { Users, UserPlus, Shield, Activity, Database, MessageSquare, Bug, TrendingUp, Flag, Bell, Bot, ShieldAlert } from \"lucide-react\""
content = content.replace(import_old, import_new)

# Keep the rest (assuming it didn't conflict, but need to check if there are other conflicts)
# Let's check for other "======="
if "=======" in content:
    print("WARNING: More conflicts found")

with open("src/app/admin/page.tsx", "w") as f:
    f.write(content)
