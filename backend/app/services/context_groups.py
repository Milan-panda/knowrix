from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import ContextGroup, ContextGroupSource, Source

SYSTEM_GROUP_MAPPING: dict[str, set[str]] = {
    "docs": {"pdf", "file", "docx"},
    "web": {"web", "youtube"},
    "code": {"github", "github_discussions"},
    "notion": {"notion"},
}


async def sync_system_context_groups(workspace_id: UUID, db: AsyncSession) -> None:
    result = await db.execute(
        select(Source).where(Source.workspace_id == workspace_id)
    )
    sources = list(result.scalars().all())

    # Backward-compatible with older DBs where `is_system` may still be int (0/1).
    groups_result = await db.execute(
        select(ContextGroup).where(ContextGroup.workspace_id == workspace_id)
    )
    existing_groups = {g.name: g for g in groups_result.scalars().all() if bool(g.is_system)}

    for group_name in SYSTEM_GROUP_MAPPING.keys():
        if group_name not in existing_groups:
            group = ContextGroup(
                workspace_id=workspace_id,
                name=group_name,
                is_system=1,
            )
            db.add(group)
            await db.flush()
            existing_groups[group_name] = group

    desired_memberships: list[dict] = []
    for source in sources:
        for group_name, source_types in SYSTEM_GROUP_MAPPING.items():
            if source.type in source_types:
                desired_memberships.append(
                    {
                        "group_id": existing_groups[group_name].id,
                        "source_id": source.id,
                    }
                )

    desired_pairs = {(m["group_id"], m["source_id"]) for m in desired_memberships}
    group_ids = [g.id for g in existing_groups.values()]
    if group_ids:
        links_result = await db.execute(
            select(ContextGroupSource).where(ContextGroupSource.group_id.in_(group_ids))
        )
        for link in links_result.scalars().all():
            if (link.group_id, link.source_id) not in desired_pairs:
                await db.delete(link)

    if desired_memberships:
        stmt = pg_insert(ContextGroupSource).values(desired_memberships)
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["group_id", "source_id"]
        )
        await db.execute(stmt)
