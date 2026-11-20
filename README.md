# Dodge Ridge 滑雪路况看板

公开移动版包含 Santa Clara 往返 Dodge Ridge 的州公路地图、沿途城镇和山脚／山顶天气、Caltrans 通报和摄像头入口。天气和路况快照保存在访问者的浏览器里。

## 在 GitHub Pages 发布

将本目录文件放在公开仓库的 `main` 分支根目录。在仓库的 **Settings → Pages** 选择 **Deploy from a branch**，再选 `main` 和 `/(root)`。发布后用 Pages 设置页显示的 HTTPS 地址打开。站点支持项目仓库的子路径。

## 手动刷新

打开看板时会核对去回程路况。「刷新」同时更新 Open-Meteo 和 NWS 预报。两个方向分别筛选主干公路通报，回程匝道和地方道路以导航为准。沿途城镇对照表显示 16 天当地 07:00–19:00 的天气和高低温。早晨驾驶展望评估接下来 16 次 05:00 出发的天气，较远日期用于粗略规划。缺测时显示暂无数据。NWS 雪水比保留官方入口。沿途摄像头入口打开 Caltrans QuickMap 对应位置。

GitHub Actions 每隔约 10 分钟从 Caltrans 采集 CHP，发布只含监控路段的快照到 `chp-data` 分支。失败时保留上一份快照，超过 20 分钟的 CHP 快照不参与关键路况着色。页面保留官方通报链接和各来源更新时间。

[Open-Meteo 天气数据](https://open-meteo.com/en/docs) 按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 提供，本页对数据做了分组和单位换算。地图底图由 [USGS National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) 提供。道路数据来自 [Caltrans CWWP](https://dot.ca.gov/programs/traffic-operations/traveler-information/cwwp)，警报和部分预报来自 [NWS](https://www.weather.gov/documentation/services-web-api)。
