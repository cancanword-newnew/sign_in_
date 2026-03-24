/**
 * 纯前端 API 实现
 * 将原先 Python 的 requests 替换为原生的 fetch。
 * 注意：部分请求涉及跨域 (CORS) 和 Mixed Content 问题，在浏览器中直接运行可能需要安装跨域插件或使用代理。
 */

class Api {
    constructor() {
        this.userId = null;
        this.sessionId = null;
        this._week_cache = {};
        this.headers = {
            // 在浏览器中修改 User-Agent 可能被忽略，而且跨域时通常也无法随意发送自定义 header
        };
    }

    merge_courses(courses) {
        if (!courses || !courses.length) {
            return [];
        }
        const merged = new Map();
        for (const c of courses) {
            const key = `${c.courseNum || ""}|${c.classBeginTime || ""}|${c.classroomName || ""}`;
            if (!merged.has(key)) {
                const mc = { ...c };
                mc.teachers = [c.teacherName || "未知"];
                mc.courseSchedIds = [c.id || ""];
                merged.set(key, mc);
            } else {
                const existing = merged.get(key);
                const t = c.teacherName || "未知";
                if (!existing.teachers.includes(t)) {
                    existing.teachers.push(t);
                }
                existing.courseSchedIds.push(c.id || "");
            }
        }
        return Array.from(merged.values());
    }

    async login(student_id) {
        try {
            const url = new URL("https://iclass.buaa.edu.cn:8346/app/user/login.action");
            url.searchParams.append("password", "");
            url.searchParams.append("phone", student_id);
            url.searchParams.append("userLevel", "1");
            url.searchParams.append("verificationType", "2");
            url.searchParams.append("verificationUrl", "");

            const res = await fetch(url.toString(), {
                method: "GET"
            });
            const data = await res.json();
            
            if (data.STATUS !== "0") {
                return { success: false, error: data.ERRORMSG || "登录失败" };
            }
            
            this.userId = data.result.id;
            this.sessionId = data.result.sessionId;
            // 不再将 sessionId 设为 headers，而是之后附加到 URL 参数中避免触发跨域 OPTIONS 预检请求
            
            return { success: true, userId: this.userId };
        } catch (e) {
            console.error("Login Error:", e);
            return { success: false, error: "网络异常/跨域拦截: " + e.toString() };
        }
    }

    async _fetch_day(date_str) {
        try {
            const url = new URL("https://iclass.buaa.edu.cn:8346/app/course/get_stu_course_sched.action");
            url.searchParams.append("dateStr", date_str);
            url.searchParams.append("id", this.userId);
            // 将 sessionId 附加到 URL 中，而不是通过 header 传输
            if (this.sessionId) {
                url.searchParams.append("sessionId", this.sessionId);
            }

            const res = await fetch(url.toString(), {
                method: "GET",
                // 删除 headers 的绑定，以便其成为 CORS 简单请求
            });
            if (res.ok) {
                return await res.json();
            }
            return null;
        } catch (e) {
            console.error("Fetch day error:", e);
            return null;
        }
    }

    async get_week_courses(week_number, year, month, day) {
        let semester_start;
        try {
            semester_start = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            if (isNaN(semester_start.getTime())) throw new Error();
        } catch (e) {
            semester_start = new Date(2025, 8, 1); 
        }

        const start_date = new Date(semester_start.getTime() + (parseInt(week_number) - 1) * 7 * 24 * 60 * 60 * 1000);
        const week_dates = [];
        for (let i = 0; i < 7; i++) {
            week_dates.push(new Date(start_date.getTime() + i * 24 * 60 * 60 * 1000));
        }

        this._week_cache = {};
        const result = {};

        const fetchPromises = week_dates.map(async (d, idx) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dayNum = String(d.getDate()).padStart(2, '0');
            const date_str = `${y}${m}${dayNum}`;
            
            const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
            const formattedDate = `${m}-${dayNum}`;
            const today = new Date();
            const isToday = d.getFullYear() === today.getFullYear() && 
                            d.getMonth() === today.getMonth() && 
                            d.getDate() === today.getDate();

            try {
                const data = await this._fetch_day(date_str);
                const raw = (data && data.STATUS === "0") ? (data.result || []) : [];
                this._week_cache[idx] = raw;
                const merged = this.merge_courses(raw);
                result[idx] = {
                    date: formattedDate,
                    weekday: weekdays[idx],
                    isToday: isToday,
                    courses: merged
                };
            } catch (e) {
                result[idx] = {
                    date: formattedDate,
                    weekday: weekdays[idx],
                    isToday: false,
                    courses: []
                };
            }
        });

        await Promise.all(fetchPromises);
        return result;
    }

    async sign_course(course_ids_json) {
        const course_ids = typeof course_ids_json === "string" ? JSON.parse(course_ids_json) : course_ids_json;
        let success = 0;

        for (const cid of course_ids) {
            try {
                // 注意：这里原版是 HTTP 8081 端口，如果部署在 HTTPS 的 GitHub Pages，这里会被拦截 (Mixed Content)
                // 若需要规避，可以通过修改后端 API 成 https 协议（如果是受支持的），否则必须借助用户端禁用安全检查。
                const url = new URL(`http://iclass.buaa.edu.cn:8081/app/course/stu_scan_sign.action`);
                url.searchParams.append("courseSchedId", cid);
                url.searchParams.append("timestamp", Date.now());
                url.searchParams.append("id", this.userId);
                if (this.sessionId) {
                    url.searchParams.append("sessionId", this.sessionId);
                }

                const res = await fetch(url.toString(), {
                    method: "POST",
                    // 删除 headers 的绑定
                });

                if (res.ok) {
                    const text = await res.text();
                    try {
                        const json = JSON.parse(text);
                        if (json.STATUS === "0") {
                            success += 1;
                        }
                    } catch (e) {
                        if (text.includes("成功") || text.includes("SUCCESS")) {
                            success += 1;
                        }
                    }
                }
            } catch (e) {
                console.error("Sign error:", e);
                // Ignore errors to mimic pass
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return { success, total: course_ids.length };
    }

    async batch_sign_week(week_number, year, month, day) {
        if (Object.keys(this._week_cache).length === 0) {
            await this.get_week_courses(week_number, year, month, day);
        }

        const all_ids = [];
        for (const day_courses of Object.values(this._week_cache)) {
            for (const c of day_courses) {
                if (c.id) {
                    all_ids.push(c.id);
                }
            }
        }

        if (all_ids.length === 0) {
            return { success: 0, total: 0 };
        }

        return await this.sign_course(all_ids);
    }

    get_current_week(year, month, day) {
        try {
            const semester_start = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            if (isNaN(semester_start.getTime())) throw new Error();
            
            const diffDays = Math.floor((new Date() - semester_start) / (1000 * 60 * 60 * 24));
            return Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1));
        } catch (e) {
            return 1;
        }
    }
}

// 暴露出全局变量替换原本的 window.pywebview.api
window.api = new Api();
